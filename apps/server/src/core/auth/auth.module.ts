import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SignupService } from './services/signup.service';
import { TokenModule } from './token.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { BetterAuthService } from './better-auth/better-auth.service';
import { BetterAuthController } from './better-auth/better-auth.controller';

@Module({
  imports: [TokenModule, WorkspaceModule, ApiKeyModule],
  controllers: [AuthController, BetterAuthController],
  providers: [AuthService, SignupService, JwtStrategy, BetterAuthService],
  exports: [SignupService, BetterAuthService],
})
export class AuthModule {}
