import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthProvider, User, Workspace } from '@docmost/db/types/entity.types';
import { SsoRepo } from '@docmost/db/repos/sso/sso.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { OidcService, providerSettings } from './oidc.service';
import {
  CreateOidcProviderDto,
  SsoProviderIdDto,
  UpdateOidcProviderDto,
} from './dto/sso-provider.dto';

@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
@Controller('sso/providers')
export class SsoAdminController {
  constructor(
    private readonly ssoRepo: SsoRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly oidcService: OidcService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  private assertAdmin(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }

  private present(p: AuthProvider, workspace: Workspace) {
    const settings = providerSettings(p);
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      issuer: p.oidcIssuer,
      clientId: p.oidcClientId,
      hasClientSecret: !!p.oidcClientSecret,
      isEnabled: p.isEnabled,
      allowSignup: p.allowSignup,
      groupSync: p.groupSync,
      groupsClaim: settings.groupsClaim ?? 'groups',
      scopes: settings.scopes ?? '',
      allowUnverifiedEmail: settings.allowUnverifiedEmail === true,
      callbackUrl: this.oidcService.callbackUrl(workspace, p.id),
      createdAt: p.createdAt,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post()
  async list(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    this.assertAdmin(user, workspace);
    const providers = await this.ssoRepo.listProviders(workspace.id);
    return {
      // Other provider types (SAML, LDAP, Google) from older installs are
      // listed read-only so admins can remove them.
      providers: providers.map((p) => this.present(p, workspace)),
      enforceSso: workspace.enforceSso,
    };
  }

  private settingsFrom(dto: CreateOidcProviderDto) {
    return {
      groupsClaim: dto.groupsClaim?.trim() || 'groups',
      scopes: dto.scopes?.trim() || '',
      allowUnverifiedEmail: dto.allowUnverifiedEmail === true,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateOidcProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);
    const provider = await this.ssoRepo.insertProvider({
      workspaceId: workspace.id,
      creatorId: user.id,
      type: 'oidc',
      name: dto.name,
      oidcIssuer: dto.issuer.replace(/\/$/, ''),
      oidcClientId: dto.clientId.trim(),
      oidcClientSecret: dto.clientSecret
        ? this.oidcService.encryptSecret(dto.clientSecret)
        : null,
      isEnabled: dto.isEnabled ?? false,
      allowSignup: dto.allowSignup ?? false,
      groupSync: dto.groupSync ?? false,
      settings: this.settingsFrom(dto) as any,
    });

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_CREATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: provider.id,
      metadata: { name: provider.name, type: 'oidc', issuer: provider.oidcIssuer },
    });
    return this.present(provider, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateOidcProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);
    const existing = await this.ssoRepo.findProvider(dto.providerId, workspace.id);
    if (!existing) throw new NotFoundException('SSO provider not found');
    if (existing.type !== 'oidc') {
      throw new BadRequestException('Only OIDC providers can be edited');
    }

    const disabling = existing.isEnabled && dto.isEnabled === false;
    if (disabling && workspace.enforceSso) {
      const enabled = await this.ssoRepo.countEnabled(workspace.id);
      if (enabled <= 1) {
        throw new BadRequestException(
          'Turn off "Enforce SSO" before disabling the last SSO provider',
        );
      }
    }

    const updated = await this.ssoRepo.updateProvider(existing.id, workspace.id, {
      name: dto.name,
      oidcIssuer: dto.issuer.replace(/\/$/, ''),
      oidcClientId: dto.clientId.trim(),
      ...(dto.clientSecret !== undefined
        ? {
            oidcClientSecret: dto.clientSecret
              ? this.oidcService.encryptSecret(dto.clientSecret)
              : null,
          }
        : {}),
      isEnabled: dto.isEnabled ?? existing.isEnabled,
      allowSignup: dto.allowSignup ?? existing.allowSignup,
      groupSync: dto.groupSync ?? existing.groupSync,
      settings: this.settingsFrom(dto) as any,
    });

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_UPDATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: existing.id,
      changes: {
        before: {
          name: existing.name,
          issuer: existing.oidcIssuer,
          isEnabled: existing.isEnabled,
          allowSignup: existing.allowSignup,
        },
        after: {
          name: updated.name,
          issuer: updated.oidcIssuer,
          isEnabled: updated.isEnabled,
          allowSignup: updated.allowSignup,
          clientSecretChanged: dto.clientSecret !== undefined,
        },
      },
    });
    return this.present(updated, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async remove(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);
    const existing = await this.ssoRepo.findProvider(dto.providerId, workspace.id);
    if (!existing) throw new NotFoundException('SSO provider not found');
    if (existing.isEnabled && workspace.enforceSso) {
      const enabled = await this.ssoRepo.countEnabled(workspace.id);
      if (enabled <= 1) {
        throw new BadRequestException(
          'Turn off "Enforce SSO" before removing the last SSO provider',
        );
      }
    }
    await this.ssoRepo.softDeleteProvider(existing.id, workspace.id);
    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_DELETED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: existing.id,
      metadata: { name: existing.name, type: existing.type },
    });
  }

  /** Check that the issuer's discovery document loads. */
  @HttpCode(HttpStatus.OK)
  @Post('test')
  async test(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertAdmin(user, workspace);
    const provider = await this.ssoRepo.findProvider(dto.providerId, workspace.id);
    if (!provider) throw new NotFoundException('SSO provider not found');
    try {
      const config = await this.oidcService.getConfig(provider);
      const meta = config.serverMetadata();
      return {
        ok: true,
        issuer: meta.issuer,
        authorizationEndpoint: meta.authorization_endpoint,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
