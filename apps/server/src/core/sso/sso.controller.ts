import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { InjectKysely } from 'nestjs-kysely';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SsoRepo } from '@docmost/db/repos/sso/sso.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { SessionService } from '../session/session.service';
import {
  BETTER_AUTH_COOKIE_PREFIX,
  BetterAuthService,
} from '../auth/better-auth/better-auth.service';
import { isUserDisabled } from '../../common/helpers';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { safeRedirect } from './sso.utils';
import { toWebHeaders } from '../auth/better-auth/web-request';

const ERROR_MESSAGES: Record<string, string> = {
  signup_disabled:
    'No DocIt account exists for this email. Ask an admin to invite you.',
  account_not_linked:
    'An account with this email exists but could not be linked. The identity provider must report a verified email.',
  email_not_verified: 'Your email address is not verified with the identity provider.',
  invalid_callback_request: 'Sign-in session expired. Please try again.',
  state_mismatch: 'Sign-in session expired. Please try again.',
  please_restart_the_process: 'Sign-in session expired. Please try again.',
  unable_to_get_user_info: 'The identity provider did not return your profile.',
  email_doesn_t_match: 'The identity provider returned a different email.',
};

/** Decode an ID token payload. better-auth has already verified it. */
function idTokenClaims(idToken: string | null): Record<string, any> {
  if (!idToken) return {};
  try {
    const payload = idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Browser-facing SSO endpoints. better-auth runs the OAuth/OIDC flow; these
 * routes start it and turn its result into a DocIt session.
 */
@Controller('sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly betterAuth: BetterAuthService,
    private readonly ssoRepo: SsoRepo,
    private readonly userRepo: UserRepo,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly sessionService: SessionService,
    private readonly environmentService: EnvironmentService,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  private fail(res: FastifyReply, message: string) {
    const params = new URLSearchParams({ ssoError: message });
    return res.redirect(`/login?${params.toString()}`, 302);
  }

  @Public()
  @Get('oidc/:providerId/login')
  async login(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query('redirect') redirect: string | undefined,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    try {
      const provider = await this.ssoRepo.findProvider(providerId, workspace.id);
      if (!provider?.isEnabled || provider.type !== 'oidc') {
        return this.fail(res, 'This sign-in provider is not available');
      }
      const complete = new URLSearchParams({
        provider: providerId,
        redirect: safeRedirect(redirect),
      });
      const { url, setCookies } = await this.betterAuth.startOAuth({
        workspace,
        providerId,
        callbackURL: `/api/sso/complete?${complete.toString()}`,
        errorCallbackURL: '/api/sso/error',
        headers: toWebHeaders(req),
      });
      if (setCookies.length) res.header('set-cookie', setCookies);
      return res.redirect(url, 302);
    } catch (err) {
      this.logger.warn(`SSO start failed: ${(err as Error).message}`);
      return this.fail(res, (err as Error).message || 'Could not start sign-in');
    }
  }

  /** better-auth redirects here after a successful OAuth callback. */
  @Public()
  @Get('complete')
  async complete(
    @Query('provider') providerId: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const clearBetterAuthCookies = () => {
      for (const name of ['session_token', 'session_data', 'dont_remember']) {
        res.clearCookie(`${BETTER_AUTH_COOKIE_PREFIX}.${name}`, { path: '/' });
        res.clearCookie(`__Secure-${BETTER_AUTH_COOKIE_PREFIX}.${name}`, { path: '/' });
      }
    };

    try {
      const result = await this.betterAuth.getSession(workspace, toWebHeaders(req));
      if (!result?.user?.id) {
        return this.fail(res, 'Sign-in session expired. Please try again.');
      }
      await this.betterAuth.discardSession(workspace.id, result.session.token);
      clearBetterAuthCookies();

      const user = await this.userRepo.findById(result.user.id, workspace.id);
      if (!user || isUserDisabled(user)) {
        return this.fail(res, 'Your account has been deactivated');
      }

      const provider = providerId
        ? await this.ssoRepo.findProvider(providerId, workspace.id)
        : undefined;
      if (provider?.groupSync) {
        await this.syncGroups(user, workspace, provider.id, provider.settings);
      }

      await this.userRepo.updateLastLogin(user.id, workspace.id);
      this.auditService.logWithContext(
        {
          event: AuditEvent.USER_LOGIN,
          resourceType: AuditResource.USER,
          resourceId: user.id,
          metadata: {
            source: 'oidc',
            providerId: provider?.id,
            providerName: provider?.name,
          },
        },
        { workspaceId: workspace.id, actorId: user.id },
      );

      const authToken = await this.sessionService.createSessionAndToken(user);
      res.setCookie('authToken', authToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: this.environmentService.getCookieExpiresIn(),
        secure: this.environmentService.isHttps(),
      });
      return res.redirect(safeRedirect(redirect), 302);
    } catch (err) {
      this.logger.warn(`SSO completion failed: ${(err as Error).message}`);
      clearBetterAuthCookies();
      return this.fail(res, 'Sign-in failed');
    }
  }

  /** better-auth's error redirect target. */
  @Public()
  @Get('error')
  async error(
    @Query('error') code: string | undefined,
    @Query('error_description') description: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const message =
      (code && ERROR_MESSAGES[code]) ||
      description ||
      (code ? `Sign-in failed (${code.replace(/_/g, ' ')})` : 'Sign-in failed');
    return this.fail(res, message);
  }

  /**
   * Add the user to DocIt groups named in the IdP groups claim. Memberships
   * are only added, never removed, so manual assignments stay.
   */
  private async syncGroups(
    user: User,
    workspace: Workspace,
    providerId: string,
    settings: unknown,
  ) {
    const claimName = (settings as any)?.groupsClaim || 'groups';
    const account = await this.db
      .selectFrom('authAccounts')
      .select(['idToken'])
      .where('userId', '=', user.id)
      .where('authProviderId', '=', providerId)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('updatedAt', 'desc')
      .executeTakeFirst();
    const claim = idTokenClaims(account?.idToken ?? null)[claimName];
    const names = (Array.isArray(claim) ? claim : typeof claim === 'string' ? [claim] : [])
      .map((g) => String(g).trim())
      .filter(Boolean);

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
