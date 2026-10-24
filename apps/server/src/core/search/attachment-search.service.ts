import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';

export type AttachmentSearchResult = {
  id: string;
  fileName: string;
  fileExt: string;
  mimeType: string | null;
  fileSize: number | null;
  updatedAt: Date;
  highlight: string;
  page: { id: string; slugId: string; title: string | null };
  space: { id: string; name: string | null; slug: string };
};

export type AttachmentSearchOptions = {
  query: string;
  spaceId?: string;
  limit: number;
  userId: string;
  workspaceId: string;
};

@Injectable()
export class AttachmentSearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
  ) {}

  async search(
    opts: AttachmentSearchOptions,
  ): Promise<{ items: AttachmentSearchResult[] }> {
    const query = opts.query?.trim();
    if (!query) return { items: [] };
    const searchQuery = tsquery(query + '*');
    const tsq = sql`to_tsquery('english', f_unaccent(${searchQuery}))`;

    let q = this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id',
        'attachments.fileName',
        'attachments.fileExt',
        'attachments.mimeType',
        'attachments.fileSize',
        'attachments.updatedAt',
        'pages.id as pageId',
        'pages.slugId as pageSlugId',
        'pages.title as pageTitle',
        'spaces.id as spaceId',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
        sql<string>`ts_headline('english', substring(attachments.text_content, 1, 100000), ${tsq}, 'MinWords=9, MaxWords=12, MaxFragments=2')`.as(
          'highlight',
        ),
        sql<number>`ts_rank(attachments.tsv, ${tsq})`.as('rank'),
      ])
      .where('attachments.workspaceId', '=', opts.workspaceId)
      .where('attachments.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .where(sql<boolean>`attachments.tsv @@ ${tsq}`)
      .orderBy('rank', 'desc')
      .limit(opts.limit);

    q = opts.spaceId
      ? q.where('attachments.spaceId', '=', opts.spaceId)
      : q.where(
          'attachments.spaceId',
          'in',
          this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId),
        );

    const rows = await q.execute();
    if (rows.length === 0) return { items: [] };

    // Respect page-level restrictions on the page holding each file.
    const accessible = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: [...new Set(rows.map((r) => r.pageId))],
        userId: opts.userId,
        spaceId: opts.spaceId,
      }),
    );

    return {
      items: rows
        .filter((r) => accessible.has(r.pageId))
        .map((r) => ({
          id: r.id,
          fileName: r.fileName,
          fileExt: r.fileExt,
          mimeType: r.mimeType,
          fileSize: r.fileSize ? Number(r.fileSize) : null,
          updatedAt: r.updatedAt,
          highlight: (r.highlight ?? '').replace(/\s+/g, ' '),
          page: { id: r.pageId, slugId: r.pageSlugId, title: r.pageTitle },
          space: { id: r.spaceId, name: r.spaceName, slug: r.spaceSlug },
        })),
    };
  }
}
