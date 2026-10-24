import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { InternalApiClient } from './internal-api.client';

@Module({
  controllers: [McpController],
  providers: [McpService, InternalApiClient],
  exports: [InternalApiClient],
})
export class McpModule {}
