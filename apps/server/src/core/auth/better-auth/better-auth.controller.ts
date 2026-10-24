import { All, Controller, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import { BetterAuthService } from './better-auth.service';
import { sendWebResponse, toWebRequest } from './web-request';

/**
 * Mounts better-auth's HTTP routes at /api/auth/ba/* (OAuth callbacks and
 * the other endpoints its plugins register).
 */
@SkipThrottle()
@Controller('auth/ba')
export class BetterAuthController {
  constructor(private readonly betterAuth: BetterAuthService) {}

  @Public()
  @All('*')
  async handle(
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const response = await this.betterAuth.handle(workspace, toWebRequest(req));
    await sendWebResponse(reply, response);
  }
}
