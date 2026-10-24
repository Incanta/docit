import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { safeRedirect } from './sso.utils';
import { SsoRepo } from '@docmost/db/repos/sso/sso.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { AuthProvider, User, Workspace } from '@docmost/db/types/entity.types';
import {
  EncryptionPurpose,
  EncryptionService,
} from '../../integrations/encryption/encryption.service';
import { DomainService } from '../../integrations/environment/domain.service';
import { SignupService } from '../auth/services/signup.service';
import { isUserDisabled } from '../../common/helpers';
import { validateAllowedEmail } from '../auth/auth.util';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';

export const OIDC_STATE_COOKIE = 'docit_oidc';
const STATE_TTL_MS = 10 * 60 * 1000;
const CONFIG_CACHE_MS = 60 * 60 * 1000;

export type OidcProviderSettings = {
  /** ID token / userinfo claim that lists the user's groups. */
  groupsClaim?: string;
  /** Extra scopes beyond "openid email profile". */
  scopes?: string;
  /** Accept emails the IdP has not marked as verified. */
  allowUnverifiedEmail?: boolean;
};

type StatePayload = {
  providerId: string;
  workspaceId: string;
  codeVerifier: string;
  state: string;
  nonce: string;
  redirect: string;
  createdAt: number;
};

export function providerSettings(p: AuthProvider): OidcProviderSettings {
  return (p.settings as OidcProviderSettings) ?? {};
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly configs = new Map<
    string,
    { config: oidc.Configuration; key: string; at: number }
  >();

  constructor(
    private readonly ssoRepo: SsoRepo,
    private readonly userRepo: UserRepo,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly signupService: SignupService,
    private readonly encryption: EncryptionService,
    private readonly domainService: DomainService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  encryptSecret(secret: string) {
    return this.encryption.encrypt(secret, EncryptionPurpose.SSO_CREDENTIALS);
  }

  private decryptSecret(secret: string | null): string | undefined {
    if (!secret) return undefined;
    try {
      return this.encryption.decrypt(secret, EncryptionPurpose.SSO_CREDENTIALS);
    } catch {
      this.logger.error('Could not decrypt an OIDC client secret');
      return undefined;
    }
  }

  callbackUrl(workspace: Workspace, providerId: string): string {
    return `${this.domainService.getWorkspaceUrl(workspace)}/api/sso/oidc/${providerId}/callback`;
  }

  /** Discover (and cache) the IdP configuration for a provider. */
  async getConfig(provider: AuthProvider): Promise<oidc.Configuration> {
    if (!provider.oidcIssuer || !provider.oidcClientId) {
      throw new BadRequestException('OIDC provider is not fully configured');
    }
    const key = `${provider.oidcIssuer}|${provider.oidcClientId}|${provider.updatedAt?.toString()}`;
    const cached = this.configs.get(provider.id);
    if (cached && cached.key === key && Date.now() - cached.at < CONFIG_CACHE_MS) {
      return cached.config;
    }

    const secret = this.decryptSecret(provider.oidcClientSecret);
    const issuer = new URL(provider.oidcIssuer);
    const config = await oidc.discovery(
      issuer,
      provider.oidcClientId,
      secret,
      secret ? undefined : oidc.None(),
      // Plain http only for local development IdPs.
      issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : undefined,
    );
    this.configs.set(provider.id, { config, key, at: Date.now() });
    return config;
  }

  async startLogin(opts: {
    provider: AuthProvider;
    workspace: Workspace;
    redirect?: string;
  }): Promise<{ url: string; cookie: string }> {
    const { provider, workspace } = opts;
    const config = await this.getConfig(provider);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const scopes = ['openid', 'email', 'profile', ...(providerSettings(provider).scopes?.split(/[\s,]+/).filter(Boolean) ?? [])];

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.callbackUrl(workspace, provider.id),
      scope: [...new Set(scopes)].join(' '),
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const payload: StatePayload = {
      providerId: provider.id,
      workspaceId: workspace.id,
      codeVerifier,
      state,
      nonce,
      redirect: safeRedirect(opts.redirect),
      createdAt: Date.now(),
    };
    const cookie = this.encryption.encrypt(
      JSON.stringify(payload),
      EncryptionPurpose.SSO_STATE,
    );
    return { url: url.href, cookie };
  }

  readState(cookie: string | undefined, providerId: string, workspaceId: string): StatePayload {
    if (!cookie) throw new BadRequestException('Sign-in session expired. Please try again.');
    let payload: StatePayload;
    try {
      payload = JSON.parse(this.encryption.decrypt(cookie, EncryptionPurpose.SSO_STATE));
    } catch {
      throw new BadRequestException('Invalid sign-in session. Please try again.');
    }
    if (
      payload.providerId !== providerId ||
      payload.workspaceId !== workspaceId ||
      Date.now() - payload.createdAt > STATE_TTL_MS
    ) {
      throw new BadRequestException('Sign-in session expired. Please try again.');
    }
    return payload;
  }

  /** Exchange the authorization code and resolve (or create) the DocIt user. */
  async completeLogin(opts: {
    provider: AuthProvider;
    workspace: Workspace;
    currentUrl: URL;
    state: StatePayload;
  }): Promise<User> {
    const { provider, workspace, state } = opts;
    const config = await this.getConfig(provider);

    // The IdP redirects to the public callback URL; validate against it
    // rather than the URL as seen behind a proxy.
    const callback = new URL(this.callbackUrl(workspace, provider.id));
    callback.search = opts.currentUrl.search;

    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: state.codeVerifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });

    let claims: Record<string, any> = { ...(tokens.claims() ?? {}) };
    if (tokens.access_token && (!claims.email || !claims.name)) {
      try {
        const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        claims = { ...info, ...claims, email: claims.email ?? info.email, name: claims.name ?? info.name };
      } catch (err) {
        this.logger.debug(`UserInfo request failed: ${(err as Error).message}`);
      }
    }

    const sub = String(claims.sub ?? '');
    const email = String(claims.email ?? '').trim().toLowerCase();
    if (!sub) throw new BadRequestException('The identity provider did not return a subject');
    if (!email) {
      throw new BadRequestException(
        'The identity provider did not return an email address. Add the "email" scope or claim.',
      );
    }
    const settings = providerSettings(provider);
    if (claims.email_verified === false && !settings.allowUnverifiedEmail) {
      throw new ForbiddenException('Your email address is not verified with the identity provider');
    }

    const user = await this.resolveUser({
      provider,
      workspace,
      sub,
      email,
      name: String(claims.name ?? claims.preferred_username ?? '').slice(0, 50) || undefined,
    });

    if (provider.groupSync) {
      await this.syncGroups(user, workspace, claims[settings.groupsClaim || 'groups']);
    }

    this.auditService.logWithContext(
      {
        event: AuditEvent.USER_LOGIN,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        metadata: { source: 'oidc', providerId: provider.id, providerName: provider.name },
      },
      { workspaceId: workspace.id, actorId: user.id },
    );

    return user;
  }

  private async resolveUser(opts: {
    provider: AuthProvider;
    workspace: Workspace;
    sub: string;
    email: string;
    name?: string;
  }): Promise<User> {
    const { provider, workspace, sub, email } = opts;

    const account = await this.ssoRepo.findAccount(provider.id, sub);
    let user = account
      ? await this.userRepo.findById(account.userId, workspace.id)
      : await this.userRepo.findByEmail(email, workspace.id);

    if (user) {
      if (isUserDisabled(user)) {
        throw new ForbiddenException('Your account has been deactivated');
      }
      if (!account) {
        // First SSO login for an existing user: link by verified email.
        await this.ssoRepo
          .linkAccount({
            userId: user.id,
            workspaceId: workspace.id,
            authProviderId: provider.id,
            providerUserId: sub,
          })
          .catch((err) => {
            this.logger.warn(`Could not link SSO account for ${user.id}: ${err.message}`);
            throw new ForbiddenException(
              'This account is already linked to a different identity at this provider',
            );
          });
      }
      await this.userRepo.updateLastLogin(user.id, workspace.id);
      return user;
    }

    if (!provider.allowSignup) {
      throw new ForbiddenException(
        'No DocIt account exists for this email. Ask an admin to invite you.',
      );
    }
    validateAllowedEmail(email, workspace);

    // SSO users get a random password they never see; they can set one
    // through "forgot password" if the workspace allows password login.
    user = await this.signupService.signup(
      {
        name: opts.name,
        email,
        password: randomBytes(32).toString('base64url'),
        hasGeneratedPassword: true,
      } as any,
      workspace.id,
    );
    await this.ssoRepo.linkAccount({
      userId: user.id,
      workspaceId: workspace.id,
      authProviderId: provider.id,
      providerUserId: sub,
    });
    return user;
  }

  /**
   * Add the user to DocIt groups whose names match the IdP groups claim.
   * Memberships are only added, never removed, so manual assignments stay.
   */
  private async syncGroups(user: User, workspace: Workspace, claim: unknown) {
    const names = (Array.isArray(claim) ? claim : typeof claim === 'string' ? [claim] : [])
      .map((g) => String(g).trim().toLowerCase())
      .filter(Boolean);
    if (!names.length) return;

    for (const name of [...new Set(names)].slice(0, 100)) {
      const group = await this.groupRepo.findByName(name, workspace.id);
      if (!group) continue;
      try {
        await this.groupUserRepo.insertGroupUser({
          userId: user.id,
          groupId: group.id,
        });
      } catch {
        // Already a member.
      }
    }
  }
}
