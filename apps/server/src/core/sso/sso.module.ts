import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import { SsoController } from './sso.controller';
import { SsoAdminController } from './sso-admin.controller';

// Sign-in flows run in better-auth (see AuthModule); this module exposes
// the SSO entry points and provider management.
@Module({
  imports: [AuthModule, SessionModule],
  controllers: [SsoController, SsoAdminController],
})
export class SsoModule {}
