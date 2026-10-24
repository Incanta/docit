import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InsertableAudit } from '@docmost/db/types/entity.types';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';

export type AuditLogFilters = {
  events?: string[];
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorType?: string;
  spaceId?: string;
  startDate?: Date;
  endDate?: Date;
};

@Injectable()
export class AuditRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(rows: InsertableAudit | InsertableAudit[]): Promise<void> {
    const values = Array.isArray(rows) ? rows : [rows];
    if (values.length === 0) return;
    await this.db.insertInto('audit').values(values).execute();
  }

  private baseQuery(workspaceId: string, filters: AuditLogFilters) {
    let query = this.db
      .selectFrom('audit')
      .selectAll('audit')
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.email', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'audit.actorId'),
        ).as('actor'),
      )
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('spaces')
            .select(['spaces.id', 'spaces.name', 'spaces.slug'])
            .whereRef('spaces.id', '=', 'audit.spaceId'),
        ).as('space'),
      )
      .where('audit.workspaceId', '=', workspaceId);

    if (filters.events?.length) {
      query = query.where('audit.event', 'in', filters.events);
    }
    if (filters.resourceType) {
      query = query.where('audit.resourceType', '=', filters.resourceType);
    }
    if (filters.resourceId) {
      query = query.where('audit.resourceId', '=', filters.resourceId);
    }
    if (filters.actorId) {
      query = query.where('audit.actorId', '=', filters.actorId);
    }
    if (filters.actorType) {
      query = query.where('audit.actorType', '=', filters.actorType);
    }
    if (filters.spaceId) {
      query = query.where('audit.spaceId', '=', filters.spaceId);
    }
    if (filters.startDate) {
      query = query.where('audit.createdAt', '>=', filters.startDate);
    }
    if (filters.endDate) {
      query = query.where('audit.createdAt', '<=', filters.endDate);
    }
    return query;
  }

  async findLogs(
    workspaceId: string,
    filters: AuditLogFilters,
    pagination: { limit: number; cursor?: string; beforeCursor?: string },
  ) {
    return executeWithCursorPagination(this.baseQuery(workspaceId, filters), {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'audit.id', direction: 'desc', key: 'id' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  /** Streams rows for export in id order, newest first, capped at `max`. */
  async findForExport(
    workspaceId: string,
    filters: AuditLogFilters,
    max: number,
  ) {
    return this.baseQuery(workspaceId, filters)
      .orderBy('audit.id', 'desc')
      .limit(max)
      .execute();
  }

  async listDistinctEvents(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('audit')
      .select('event')
      .distinct()
      .where('workspaceId', '=', workspaceId)
      .orderBy('event')
      .execute();
    return rows.map((r) => r.event);
  }

  /**
   * Delete entries older than each workspace's retention window.
   * Workspaces without a retention setting keep their history forever.
   */
  async deleteExpired(): Promise<number> {
    const result = await sql`
      DELETE FROM audit a
      USING workspaces w
      WHERE a.workspace_id = w.id
        AND w.audit_retention_days IS NOT NULL
        AND w.audit_retention_days > 0
        AND a.created_at < now() - (w.audit_retention_days || ' days')::interval
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0);
  }
}
