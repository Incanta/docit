import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AuditRepo } from '@docmost/db/repos/audit/audit.repo';
import { InsertableAudit } from '@docmost/db/types/entity.types';
import {
  ActorType,
  AuditLogPayload,
  AuditResource,
} from '../../common/events/audit-events';
import {
  AUDIT_CONTEXT_KEY,
  AuditContext,
} from '../../common/middlewares/audit-context.middleware';
import { AuditLogContext, IAuditService } from './audit.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Persists audit events to the `audit` table.
 *
 * Writes are fire-and-forget: a failed audit insert is logged but never
 * fails the request that triggered it.
 */
@Injectable()
export class DbAuditService implements IAuditService {
  private readonly logger = new Logger(DbAuditService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly auditRepo: AuditRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  log(payload: AuditLogPayload): void {
    const ctx = this.getClsContext();
    if (!ctx?.workspaceId) {
      this.logger.debug(
        `Skipping audit event ${payload.event}: no workspace in request context`,
      );
      return;
    }
    this.write([this.toRow(payload, ctx)]);
  }

  logWithContext(payload: AuditLogPayload, context: AuditLogContext): void {
    this.write([this.toRow(payload, this.mergeContext(context))]);
  }

  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void {
    const ctx = this.mergeContext(context);
    this.write(payloads.map((p) => this.toRow(p, ctx)));
  }

  setActorId(actorId: string): void {
    const ctx = this.getClsContext();
    if (ctx) {
      ctx.actorId = actorId;
      this.cls.set(AUDIT_CONTEXT_KEY, ctx);
    }
  }

  setActorType(actorType: ActorType): void {
    const ctx = this.getClsContext();
    if (ctx) {
      ctx.actorType = actorType;
      this.cls.set(AUDIT_CONTEXT_KEY, ctx);
    }
  }

  async updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): Promise<void> {
    await this.db
      .updateTable('workspaces')
      .set({ auditRetentionDays: retentionDays })
      .where('id', '=', workspaceId)
      .execute();
  }

  @Interval('audit-retention-cleanup', 6 * 60 * 60 * 1000)
  async cleanupExpired(): Promise<void> {
    try {
      const deleted = await this.auditRepo.deleteExpired();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired audit log entries`);
      }
    } catch (err) {
      this.logger.error('Audit retention cleanup failed', err);
    }
  }

  private getClsContext(): AuditContext | undefined {
    if (!this.cls.isActive()) return undefined;
    return this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
  }

  /** Explicit context wins; missing fields fall back to the request context. */
  private mergeContext(context: AuditLogContext): AuditContext {
    const cls = this.getClsContext();
    return {
      workspaceId: context.workspaceId,
      actorId: context.actorId ?? cls?.actorId ?? null,
      actorType: context.actorType ?? cls?.actorType ?? 'user',
      ipAddress: context.ipAddress ?? cls?.ipAddress ?? null,
      userAgent: context.userAgent ?? cls?.userAgent ?? null,
    };
  }

  private toRow(payload: AuditLogPayload, ctx: AuditContext): InsertableAudit {
    // Unauthenticated user events (login, signup, password reset) are the
    // user acting on their own account.
    if (
      !ctx.actorId &&
      payload.resourceType === AuditResource.USER &&
      payload.resourceId &&
      UUID_RE.test(payload.resourceId)
    ) {
      ctx = { ...ctx, actorId: payload.resourceId, actorType: 'user' };
    }
    const actorType: ActorType = ctx.actorId
      ? ctx.actorType
      : ctx.actorType === 'user'
        ? 'system'
        : ctx.actorType;
    return {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId ?? null,
      actorType,
      event: payload.event,
      resourceType: payload.resourceType,
      // resource_id is a uuid column; non-uuid ids go into metadata instead.
      resourceId:
        payload.resourceId && UUID_RE.test(payload.resourceId)
          ? payload.resourceId
          : null,
      spaceId: payload.spaceId ?? null,
      changes: (payload.changes as any) ?? null,
      metadata:
        payload.resourceId && !UUID_RE.test(payload.resourceId)
          ? ({ ...(payload.metadata ?? {}), resourceId: payload.resourceId } as any)
          : ((payload.metadata as any) ?? null),
      ipAddress: normalizeIp(ctx.ipAddress),
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    };
  }

  private write(rows: InsertableAudit[]): void {
    const valid = rows.filter((r) => r.workspaceId);
    if (valid.length === 0) return;
    this.auditRepo.insert(valid).catch((err) => {
      this.logger.error(
        `Failed to write ${valid.length} audit event(s): ${err?.message}`,
      );
    });
  }
}

/** The ip column is `inet`; drop anything Postgres would reject. */
function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const cleaned = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^[0-9.]+$/.test(cleaned) || /^[0-9a-f:]+$/i.test(cleaned)) {
    return cleaned;
  }
  return null;
}
