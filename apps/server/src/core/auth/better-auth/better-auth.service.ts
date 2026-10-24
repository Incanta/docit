import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { randomBytes } from 'node:crypto';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  EncryptionPurpose,
  EncryptionService,
} from '../../../integrations/encryption/encryption.service';
import { DomainService } from '../../../integrations/environment/domain.service';
import { comparePasswordHash, hashPassword } from '../../../common/helpers';
import { SignupService } from '../services/signup.service';
import { validateAllowedEmail } from '../auth.util';
import { createDocitAdapter, NewUserData } from './docit-adapter';

/** Where better-auth's own HTTP routes are mounted. */
export const BETTER_AUTH_BASE_PATH = '/api/auth/ba';
export const BETTER_AUTH_COOKIE_PREFIX = 'docit';

type OidcSettings = {
  groupsClaim?: string;
  scopes?: string;
  allowUnverifiedEmail?: boolean;
};

type CachedAuth = { key: string; auth: any };

/**
 * DocIt authenticates through better-auth: password sign-in and OAuth/OIDC
 * flows (discovery, PKCE, state, ID token checks, account linking) run in a
 * better-auth instance per workspace. Once better-auth has authenticated a
 * user, DocIt issues its own session JWT, so the API, websockets, and the
 * collaboration server keep working unchanged.
 */
@Injectable()
export class BetterAuthService {
  private readonly logger = new Logger(BetterAuthService.name);
  private readonly instances = new Map<string, CachedAuth>();
  private readonly building = new Map<string, Promise<any>>();

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly domainService: DomainService,
    private readonly encryption: EncryptionService,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly signupService: SignupService,
  ) {}

  workspaceOrigin(workspace: Workspace): string {
    return this.domainService.getWorkspaceUrl(workspace);
  }

  /** The redirect URI to register at an identity provider. */
  oauthCallbackUrl(workspace: Workspace, providerId: string): string {
    return `${this.workspaceOrigin(workspace)}${BETTER_AUTH_BASE_PATH}/callback/${providerId}`;
  }

  private decryptSecret(value: string | null): string | undefined {
    if (!value) return undefined;
    try {
      return this.encryption.decrypt(value, EncryptionPurpose.SSO_CREDENTIALS);
    } catch {
      this.logger.error('Could not decrypt an OIDC client secret');
      return undefined;
    }
  }

  private async loadProviders(workspaceId: string) {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('type', '=', 'oidc')
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt')
      .execute();
  }

  /** Forget cached instances (e.g. after an SSO provider changes). */
  invalidate(workspaceId: string) {
    this.instances.delete(workspaceId);
  }

  /** The better-auth instance for one workspace. */
  async forWorkspace(workspace: Workspace): Promise<any> {
    const providers = await this.loadProviders(workspace.id);
    const key = JSON.stringify([
      this.workspaceOrigin(workspace),
      workspace.emailDomains,
      providers.map((p) => [p.id, p.updatedAt?.toString(), p.allowSignup]),
    ]);
    const cached = this.instances.get(workspace.id);
    if (cached?.key === key) return cached.auth;

    const pending = this.building.get(key);
    if (pending) return pending;

    const build = this.build(workspace, providers)
      .then((auth) => {
        this.instances.set(workspace.id, { key, auth });
        return auth;
      })
      .finally(() => this.building.delete(key));
    this.building.set(key, build);
    return build;
  }

  private async build(workspace: Workspace, providers: any[]): Promise<any> {
    // better-auth is ESM-only; load it lazily (Node can require ESM).
    const { betterAuth } = await import('better-auth');
    const { createAdapterFactory } = await import('better-auth/adapters');
    const { genericOAuth } = await import('better-auth/plugins/generic-oauth');

    const adapterBody = createDocitAdapter({
      db: this.db,
      workspaceId: workspace.id,
      createUser: (data) => this.createUser(workspace, data),
    });

    const database = createAdapterFactory({
      config: {
        adapterId: 'docit',
        adapterName: 'DocIt',
        supportsJSON: true,
        supportsDates: true,
        supportsBooleans: true,
        supportsUUIDs: true,
        usePlural: false,
        transaction: false,
      },
      adapter: () => adapterBody as any,
    });

    const trustedProviders = providers
      .filter((p) => (p.settings as OidcSettings)?.allowUnverifiedEmail === true)
      .map((p) => p.id);

    return betterAuth({
      appName: 'DocIt',
      baseURL: this.workspaceOrigin(workspace),
      basePath: BETTER_AUTH_BASE_PATH,
      secret: this.environmentService.getAppSecret(),
      database,
      trustedOrigins: [this.workspaceOrigin(workspace)],
      emailAndPassword: {
        enabled: true,
        // Members join through invitations and DocIt's own sign-up rules.
        disableSignUp: true,
        password: {
          hash: (password: string) => hashPassword(password),
          verify: ({ hash, password }: { hash: string; password: string }) =>
            comparePasswordHash(password, hash),
        },
      },
      account: {
        accountLinking: {
          enabled: true,
          // Link OIDC identities to existing members by email when the IdP
          // says the email is verified (or the admin trusts the IdP).
          // DocIt users rarely have a locally verified email, so the local
          // check is off; the IdP check still applies.
          requireLocalEmailVerified: false,
          trustedProviders,
        },
      },
      session: {
        // Only lives between sign-in and DocIt issuing its own token.
        expiresIn: 60 * 10,
        updateAge: 60 * 10,
      },
      // Nest's throttler already rate-limits auth routes.
      rateLimit: { enabled: false },
      telemetry: { enabled: false },
      advanced: {
        cookiePrefix: BETTER_AUTH_COOKIE_PREFIX,
        useSecureCookies: this.environmentService.isHttps(),
        database: { generateId: false },
      },
      plugins: [
        genericOAuth({
          config: providers.map((p) => {
            const settings = (p.settings as OidcSettings) ?? {};
            const extra = (settings.scopes ?? '').split(/[\s,]+/).filter(Boolean);
            const issuer = String(p.oidcIssuer).replace(/\/$/, '');
            return {
              providerId: p.id,
              name: p.name,
              discoveryUrl: `${issuer}/.well-known/openid-configuration`,
              clientId: p.oidcClientId,
              clientSecret: this.decryptSecret(p.oidcClientSecret),
              scopes: [...new Set(['openid', 'email', 'profile', ...extra])],
              pkce: true,
              disableSignUp: !p.allowSignup,
            };
          }),
        }),
      ],
    } as any);
  }

  /** Called by the adapter when better-auth signs up a new OIDC user. */
  private async createUser(workspace: Workspace, data: NewUserData) {
    const fresh = await this.workspaceRepo.findById(workspace.id);
    validateAllowedEmail(data.email, fresh ?? workspace);
    // SSO users get a random password they never see.
    const user = await this.signupService.signup(
      {
        name: data.name?.slice(0, 50) || undefined,
        email: data.email,
        password: randomBytes(32).toString('base64url'),
        hasGeneratedPassword: true,
        ...(data.emailVerified ? { emailVerifiedAt: new Date() } : {}),
      } as any,
      workspace.id,
    );
    return { id: user.id };
  }

  /**
   * Verify an email and password with better-auth. Returns the user id;
   * the temporary better-auth session is discarded.
   */
  async verifyPassword(
    workspace: Workspace,
    email: string,
    password: string,
  ): Promise<string> {
    const auth = await this.forWorkspace(workspace);
    try {
      const result = await auth.api.signInEmail({
        body: { email: email.toLowerCase(), password, rememberMe: false },
      });
      if (result?.token) await this.discardSession(workspace.id, result.token);
      const userId = result?.user?.id;
      if (!userId) throw new UnauthorizedException();
      return userId;
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      const status = err?.statusCode ?? err?.status;
      if (status === 401 || status === 'UNAUTHORIZED' || status === 403) {
        throw new UnauthorizedException('Email or password does not match');
      }
      this.logger.error(`Password sign-in failed: ${err?.message}`);
      throw new BadRequestException('Sign-in failed');
    }
  }

  async discardSession(workspaceId: string, token: string) {
    await this.db
      .deleteFrom('authSessions')
      .where('token', '=', token)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  /** Serve one request to better-auth's own routes (OAuth callbacks etc.). */
  async handle(workspace: Workspace, request: Request): Promise<Response> {
    const auth = await this.forWorkspace(workspace);
    return auth.handler(request);
  }

  /** Start an OAuth/OIDC sign-in; returns the IdP URL and cookies to set. */
  async startOAuth(opts: {
    workspace: Workspace;
    providerId: string;
    callbackURL: string;
    errorCallbackURL: string;
    headers: Headers;
  }): Promise<{ url: string; setCookies: string[] }> {
    const auth = await this.forWorkspace(opts.workspace);
    const response: Response = await auth.api.signInSocial({
      body: {
        provider: opts.providerId,
        callbackURL: opts.callbackURL,
        errorCallbackURL: opts.errorCallbackURL,
        disableRedirect: true,
      },
      headers: opts.headers,
      asResponse: true,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.url) {
      throw new ForbiddenException(
        body?.message || 'This sign-in provider is not available',
      );
    }
    const setCookies =
      (response.headers as any).getSetCookie?.() ??
      (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    return { url: body.url, setCookies };
  }

  /** Read the better-auth session created at the end of an OAuth flow. */
  async getSession(workspace: Workspace, headers: Headers) {
    const auth = await this.forWorkspace(workspace);
    return auth.api.getSession({ headers });
  }
}
