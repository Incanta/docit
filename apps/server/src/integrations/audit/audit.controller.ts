import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { stringify } from 'csv-stringify/sync';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import { AuditLogFilters, AuditRepo } from '@docmost/db/repos/audit/audit.repo';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { AUDIT_SERVICE, IAuditService } from './audit.service';
import { AuditLogFilterDto, AuditRetentionDto } from './dto/audit.dto';

const EXPORT_LIMIT = 50_000;

@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditRepo: AuditRepo,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async list(
    @Body() dto: AuditLogFilterDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanRead(user, workspace);
    return this.auditRepo.findLogs(workspace.id, toFilters(dto), {
      limit: dto.limit ?? 50,
      cursor: dto.cursor,
      beforeCursor: dto.beforeCursor,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('events')
  async events(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    this.assertCanRead(user, workspace);
    const used = await this.auditRepo.listDistinctEvents(workspace.id);
    const known = Object.values(AuditEvent) as string[];
    return {
      events: [...new Set([...known, ...used])].sort(),
      resourceTypes: Object.values(AuditResource).sort(),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('export')
  async export(
    @Body() dto: AuditLogFilterDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    this.assertCanRead(user, workspace);
    const rows = await this.auditRepo.findForExport(
      workspace.id,
      toFilters(dto),
      EXPORT_LIMIT,
    );

    const csv = stringify(
      rows.map((r: any) => ({
        id: r.id,
        createdAt: new Date(r.createdAt).toISOString(),
        event: r.event,
        actorType: r.actorType,
        actorId: r.actorId ?? '',
        actorName: r.actor?.name ?? '',
        actorEmail: r.actor?.email ?? '',
        resourceType: r.resourceType,
        resourceId: r.resourceId ?? '',
        spaceId: r.spaceId ?? '',
        spaceName: r.space?.name ?? '',
        ipAddress: r.ipAddress ?? '',
        userAgent: r.userAgent ?? '',
        changes: r.changes ? JSON.stringify(r.changes) : '',
        metadata: r.metadata ? JSON.stringify(r.metadata) : '',
      })),
      { header: true },
    );

    res.headers({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    });
    res.send(csv);
  }

  @HttpCode(HttpStatus.OK)
  @RequireSessionAuth()
  @Post('retention')
  async updateRetention(
    @Body() dto: AuditRetentionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanRead(user, workspace);
    const before = workspace.auditRetentionDays ?? 0;
    const retentionDays = dto.retentionDays === 0 ? null : dto.retentionDays;
    await this.auditService.updateRetention(workspace.id, retentionDays);

    this.auditService.log({
      event: AuditEvent.WORKSPACE_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      changes: {
        before: { auditRetentionDays: before },
        after: { auditRetentionDays: dto.retentionDays },
      },
    });

    return { retentionDays: dto.retentionDays };
  }

  private assertCanRead(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Audit)) {
      throw new ForbiddenException();
    }
  }
}

function toFilters(dto: AuditLogFilterDto): AuditLogFilters {
  return {
    events: dto.events,
    resourceType: dto.resourceType,
    resourceId: dto.resourceId,
    actorId: dto.actorId,
    actorType: dto.actorType,
    spaceId: dto.spaceId,
    startDate: dto.startDate ? new Date(dto.startDate) : undefined,
    endDate: dto.endDate ? new Date(dto.endDate) : undefined,
  };
}
