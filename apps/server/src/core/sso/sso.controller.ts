import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import { SsoRepo } from '@docmost/db/repos/sso/sso.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { SessionService } from '../session/session.service';
import { OIDC_STATE_COOKIE, OidcService } from './oidc.service';

/**
 * Browser-facing OIDC endpoints. Errors send the user back to the login
 * page with a message instead of a JSON body.
 */
@Controller('sso/oidc')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly ssoRepo: SsoRepo,
    private readonly oidcService: OidcService,
    private readonly sessionService: SessionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  private cookieOptions(maxAgeSeconds: number) {
    return {
      httpOnly: true,
      // The IdP redirect is a top-level GET, which lax cookies survive.
      sameSite: 'lax' as const,
      path: '/api/sso/oidc',
      secure: this.environmentService.isHttps(),
      maxAge: maxAgeSeconds,
    };
  }

  private fail(res: FastifyReply, message: string) {
    const params = new URLSearchParams({ ssoError: message });
    return res.redirect(`/login?${params.toString()}`, 302);
  }

  private async getProvider(providerId: string, workspace: Workspace) {
    const provider = await this.ssoRepo.findProvider(providerId, workspace.id);
    if (!provider || !provider.isEnabled || provider.type !== 'oidc') {
      throw new NotFoundException('SSO provider not found');
    }
    return provider;
  }

  @Public()
  @Get(':providerId/login')
  async login(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query('redirect') redirect: string | undefined,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    try {
      const provider = await this.getProvider(providerId, workspace);
      const { url, cookie } = await this.oidcService.startLogin({
        provider,
        workspace,
        redirect,
      });
      res.setCookie(OIDC_STATE_COOKIE, cookie, this.cookieOptions(600));
      return res.redirect(url, 302);
    } catch (err) {
      this.logger.warn(`OIDC login start failed: ${(err as Error).message}`);
      return this.fail(res, (err as Error).message || 'Could not start sign-in');
    }
  }

  @Public()
  @Get(':providerId/callback')
  async callback(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const query = req.query as Record<string, string>;
    res.clearCookie(OIDC_STATE_COOKIE, { path: '/api/sso/oidc' });

    if (query.error) {
      return this.fail(
        res,
        query.error_description || `Sign-in was cancelled (${query.error})`,
      );
    }

    try {
      const provider = await this.getProvider(providerId, workspace);
      const state = this.oidcService.readState(
        req.cookies?.[OIDC_STATE_COOKIE],
        providerId,
        workspace.id,
      );
      const user = await this.oidcService.completeLogin({
        provider,
        workspace,
        currentUrl: new URL(req.url, 'http://placeholder'),
        state,
      });

      const authToken = await this.sessionService.createSessionAndToken(user);
      res.setCookie('authToken', authToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: this.environmentService.getCookieExpiresIn(),
        secure: this.environmentService.isHttps(),
      });
      return res.redirect(state.redirect, 302);
    } catch (err) {
      this.logger.warn(`OIDC callback failed: ${(err as Error).message}`);
      return this.fail(res, (err as Error).message || 'Sign-in failed');
    }
  }
}
