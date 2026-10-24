import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import { SsoController } from './sso.controller';
import { SsoAdminController } from './sso-admin.controller';
import { OidcService } from './oidc.service';

@Module({
  imports: [AuthModule, SessionModule],
  controllers: [SsoController, SsoAdminController],
  providers: [OidcService],
})
export class SsoModule {}
