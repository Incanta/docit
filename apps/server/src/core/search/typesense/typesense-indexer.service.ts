import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  ATTACHMENTS_COLLECTION,
  PAGES_COLLECTION,
  TypesenseAttachmentDoc,
  TypesenseClient,
  TypesensePageDoc,
} from './typesense.client';

const BATCH_SIZE = 200;
// Typesense keeps documents in memory; very long pages gain little past this.
const MAX_TEXT_CHARS = 200_000;

const toEpoch = (d: Date | string | null | undefined) =>
  d ? Math.floor(new Date(d).getTime() / 1000) : 0;

@Injectable()
export class TypesenseIndexerService {
  private readonly logger = new Logger(TypesenseIndexerService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly typesense: TypesenseClient,
  ) {}

  private async loadPages(pageIds: string[]) {
    if (!pageIds.length) return [];
    const pages = await this.db
      .selectFrom('pages')
      .select([
        'id',
        'workspaceId',
        'spaceId',
        'slugId',
        'title',
        'textContent',
        'icon',
        'parentPageId',
        'creatorId',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ])
      .where('id', 'in', pageIds)
      .execute();
    const labels = await this.db
      .selectFrom('pageLabels')
      .select(['pageId', 'labelId'])
      .where('pageId', 'in', pageIds)
      .execute();
    return pages.map((p) => ({
      ...p,
      labelIds: labels.filter((l) => l.pageId === p.id).map((l) => l.labelId),
    }));
  }

  private toDoc(p: Awaited<ReturnType<TypesenseIndexerService['loadPages']>>[number]): TypesensePageDoc {
    return {
      id: p.id,
      workspace_id: p.workspaceId,
      space_id: p.spaceId,
      slug_id: p.slugId,
      title: p.title ?? '',
      text: (p.textContent ?? '').slice(0, MAX_TEXT_CHARS),
      ...(p.icon ? { icon: p.icon } : {}),
      ...(p.parentPageId ? { parent_page_id: p.parentPageId } : {}),
      ...(p.creatorId ? { creator_id: p.creatorId } : {}),
      label_ids: p.labelIds,
      created_at: toEpoch(p.createdAt),
      updated_at: toEpoch(p.updatedAt),
    };
  }

  /** Upsert live pages and drop deleted ones. */
  async indexPages(pageIds: string[]) {
    if (!this.typesense.enabled || !pageIds.length) return;
    const pages = await this.loadPages(pageIds);
    const live = pages.filter((p) => !p.deletedAt);
    const gone = pageIds.filter((id) => !live.some((p) => p.id === id));

    if (live.length) {
      const results = await this.typesense.api
        .collections<TypesensePageDoc>(PAGES_COLLECTION)
        .documents()
        .import(live.map((p) => this.toDoc(p)), { action: 'upsert' });
      const failed = results.filter((r) => !r.success);
      if (failed.length) {
        this.logger.warn(`Typesense rejected ${failed.length} page documents: ${failed[0].error}`);
      }
    }
    if (gone.length) await this.deletePages(gone);
  }

  async deletePages(pageIds: string[]) {
    if (!this.typesense.enabled || !pageIds.length) return;
    const ids = pageIds.map((id) => `\`${id}\``).join(',');
    await this.typesense.api
      .collections(PAGES_COLLECTION)
      .documents()
      .delete({ filter_by: `id:[${ids}]` });
    await this.typesense.api
      .collections(ATTACHMENTS_COLLECTION)
      .documents()
      .delete({ filter_by: `page_id:[${ids}]` });
  }

  async indexAttachment(attachmentId: string) {
    if (!this.typesense.enabled) return;
    const a = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'workspaceId',
        'spaceId',
        'pageId',
        'fileName',
        'fileExt',
        'textContent',
        'updatedAt',
        'deletedAt',
      ])
      .where('id', '=', attachmentId)
      .executeTakeFirst();
    const collection = this.typesense.api.collections<TypesenseAttachmentDoc>(
      ATTACHMENTS_COLLECTION,
    );
    if (!a || a.deletedAt || !a.pageId || !a.spaceId || !a.textContent) {
      await collection
        .documents(attachmentId)
        .delete()
        .catch(() => undefined);
      return;
    }
    await collection.documents().upsert({
      id: a.id,
      workspace_id: a.workspaceId,
      space_id: a.spaceId,
      page_id: a.pageId,
      file_name: a.fileName,
      file_ext: a.fileExt,
      text: a.textContent.slice(0, MAX_TEXT_CHARS),
      updated_at: toEpoch(a.updatedAt),
    });
  }

  async deleteBy(field: 'space_id' | 'workspace_id', value: string) {
    if (!this.typesense.enabled) return;
    for (const name of [PAGES_COLLECTION, ATTACHMENTS_COLLECTION]) {
      await this.typesense.api
        .collections(name)
        .documents()
        .delete({ filter_by: `${field}:=\`${value}\`` });
    }
  }

  /** Rebuild the index for one workspace, or every workspace. */
  async reindex(workspaceId?: string) {
    if (!this.typesense.enabled) return;
    await this.typesense.ensureCollections();

    let lastId: string | null = null;
    let total = 0;
    for (;;) {
      let q = this.db
        .selectFrom('pages')
        .select('id')
        .where('deletedAt', 'is', null)
        .orderBy('id')
        .limit(BATCH_SIZE);
      if (workspaceId) q = q.where('workspaceId', '=', workspaceId);
      if (lastId) q = q.where('id', '>', lastId);
      const rows = await q.execute();
      if (!rows.length) break;
      await this.indexPages(rows.map((r) => r.id));
      total += rows.length;
      lastId = rows[rows.length - 1].id;
    }

    let aq = this.db
      .selectFrom('attachments')
      .select('id')
      .where('deletedAt', 'is', null)
      .where('textContent', 'is not', null);
    if (workspaceId) aq = aq.where('workspaceId', '=', workspaceId);
    const attachments = await aq.execute();
    for (const a of attachments) await this.indexAttachment(a.id);

    this.logger.log(
      `Typesense reindex done: ${total} pages, ${attachments.length} attachments${workspaceId ? ` in ${workspaceId}` : ''}`,
    );
  }
}
