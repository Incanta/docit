import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { ApiKeyService } from './api-key.service';
import { API_KEY_RESOURCES } from './api-key-scopes';
import {
  ApiKeyIdDto,
  CreateApiKeyDto,
  ListApiKeysDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';

// Managing keys always needs an interactive session; a key cannot mint keys.
@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
@Controller('api-keys')
export class ApiKeyController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async list(
    @Body() dto: ListApiKeysDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.list(user, workspace, {
      all: dto.adminView,
      limit: 100,
      cursor: dto.cursor,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('scopes')
  scopes() {
    return {
      resources: API_KEY_RESOURCES,
      access: ['read', 'write'],
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateApiKeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { apiKey, token } = await this.apiKeyService.create({
      user,
      workspace,
      name: dto.name,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    this.auditService.log({
      event: AuditEvent.API_KEY_CREATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: {
        name: apiKey.name,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
      },
    });

    return { ...apiKey, token };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateApiKeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const apiKey = await this.apiKeyService.getManageable(
      dto.apiKeyId,
      user,
      workspace,
    );
    await this.apiKeyService.rename(apiKey, dto.name);

    this.auditService.log({
      event: AuditEvent.API_KEY_UPDATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      changes: { before: { name: apiKey.name }, after: { name: dto.name } },
    });

    return { ...apiKey, name: dto.name };
  }

  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revoke(
    @Body() dto: ApiKeyIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const apiKey = await this.apiKeyService.getManageable(
      dto.apiKeyId,
      user,
      workspace,
    );
    await this.apiKeyService.revoke(apiKey);

    this.auditService.log({
      event: AuditEvent.API_KEY_DELETED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: { name: apiKey.name, creatorId: apiKey.creatorId },
    });
  }
}
