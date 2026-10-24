import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { SearchDTO } from '../dto/search.dto';
import { SearchResponseDto } from '../dto/search-response.dto';
import {
  AttachmentSearchOptions,
  AttachmentSearchResult,
} from '../attachment-search.service';
import {
  ATTACHMENTS_COLLECTION,
  PAGES_COLLECTION,
  TypesenseAttachmentDoc,
  TypesenseClient,
  TypesensePageDoc,
} from './typesense.client';

const quote = (v: string) => `\`${v.replace(/`/g, '')}\``;
const inList = (values: string[]) => `[${values.map(quote).join(',')}]`;

/** Typesense marks matches with <mark>; the UI expects <b>, like Postgres. */
function toBold(snippet: string | undefined): string {
  return (snippet ?? '')
    .replace(/<mark>/g, '<b>')
    .replace(/<\/mark>/g, '</b>')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchedText(highlight: string): string[] {
  return [...new Set([...highlight.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1]))];
}

@Injectable()
export class TypesenseSearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly typesense: TypesenseClient,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
  ) {}

  get enabled() {
    return this.typesense.enabled;
  }

  private async allowedSpaceIds(userId: string, spaceId?: string) {
    const ids = await this.spaceMemberRepo.getUserSpaceIds(userId);
    return spaceId ? ids.filter((id) => id === spaceId) : ids;
  }

  /** Authenticated page search; mirrors SearchService.searchPage results. */
  async searchPage(
    params: SearchDTO,
    opts: { userId: string; workspaceId: string },
  ): Promise<{ items: SearchResponseDto[] }> {
    const query = params.query?.trim() ?? '';
    const labelIds = [...new Set(params.labelIds ?? [])];
    const browse = !query && (labelIds.length > 0 || !!params.creatorId);
    if (!query && !browse) return { items: [] };

    const spaceIds = await this.allowedSpaceIds(opts.userId, params.spaceId);
    if (!spaceIds.length) return { items: [] };

    const filters = [
      `workspace_id:=${quote(opts.workspaceId)}`,
      `space_id:${inList(spaceIds)}`,
    ];
    if (params.creatorId) filters.push(`creator_id:=${quote(params.creatorId)}`);
    if (labelIds.length) filters.push(`label_ids:${inList(labelIds)}`);

    const limit = params.limit || 25;
    const result = await this.typesense.api
      .collections<TypesensePageDoc>(PAGES_COLLECTION)
      .documents()
      .search({
        q: browse ? '*' : query,
        query_by: params.titleOnly ? 'title' : 'title,text',
        query_by_weights: params.titleOnly ? undefined : '4,1',
        filter_by: filters.join(' && '),
        sort_by: browse ? 'updated_at:desc' : '_text_match:desc,updated_at:desc',
        highlight_fields: 'text',
        snippet_threshold: 30,
        highlight_affix_num_tokens: 8,
        per_page: Math.min(limit, 100),
        page: Math.floor((params.offset || 0) / limit) + 1,
        prefix: true,
        num_typos: 1,
        exclude_fields: 'text',
      });

    const hits = result.hits ?? [];
    if (!hits.length) return { items: [] };

    const accessible = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: hits.map((h) => h.document.id),
        userId: opts.userId,
        spaceId: params.spaceId,
      }),
    );
    const visible = hits.filter((h) => accessible.has(h.document.id));
    const spaces = await this.loadSpaces(visible.map((h) => h.document.space_id));

    return {
      items: visible.map((h) => {
        const doc = h.document;
        const textHighlight = (h.highlights ?? []).find((x) => x.field === 'text');
        const highlight = toBold(textHighlight?.snippet);
        return {
          id: doc.id,
          slugId: doc.slug_id,
          title: doc.title,
          icon: doc.icon ?? null,
          parentPageId: doc.parent_page_id ?? null,
          creatorId: doc.creator_id ?? null,
          rank: Number(h.text_match ?? 0),
          highlight,
          matchedText: matchedText(highlight),
          wholeWord: false,
          createdAt: new Date(doc.created_at * 1000),
          updatedAt: new Date(doc.updated_at * 1000),
          space: spaces.get(doc.space_id),
        } as SearchResponseDto & { slugId: string };
      }),
    };
  }

  async searchAttachments(
    opts: AttachmentSearchOptions,
  ): Promise<{ items: AttachmentSearchResult[] }> {
    const query = opts.query?.trim();
    if (!query) return { items: [] };
    const spaceIds = await this.allowedSpaceIds(opts.userId, opts.spaceId);
    if (!spaceIds.length) return { items: [] };

    const result = await this.typesense.api
      .collections<TypesenseAttachmentDoc>(ATTACHMENTS_COLLECTION)
      .documents()
      .search({
        q: query,
        query_by: 'file_name,text',
        query_by_weights: '3,1',
        filter_by: `workspace_id:=${quote(opts.workspaceId)} && space_id:${inList(spaceIds)}`,
        highlight_fields: 'text',
        highlight_affix_num_tokens: 8,
        per_page: opts.limit,
        exclude_fields: 'text',
      });
    const hits = result.hits ?? [];
    if (!hits.length) return { items: [] };

    const accessible = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: [...new Set(hits.map((h) => h.document.page_id))],
        userId: opts.userId,
        spaceId: opts.spaceId,
      }),
    );
    const visible = hits.filter((h) => accessible.has(h.document.page_id));
    if (!visible.length) return { items: [] };

    const rows = await this.db
      .selectFrom('attachments')
      .innerJoin('pages', 'pages.id', 'attachments.pageId')
      .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
      .select([
        'attachments.id',
        'attachments.mimeType',
        'attachments.fileSize',
        'pages.id as pageId',
        'pages.slugId as pageSlugId',
        'pages.title as pageTitle',
        'spaces.id as spaceId',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
      ])
      .where('attachments.id', 'in', visible.map((h) => h.document.id))
      .where('attachments.deletedAt', 'is', null)
      .where('pages.deletedAt', 'is', null)
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));

    return {
      items: visible
        .filter((h) => byId.has(h.document.id))
        .map((h) => {
          const doc = h.document;
          const r = byId.get(doc.id);
          const textHighlight = (h.highlights ?? []).find((x) => x.field === 'text');
          return {
            id: doc.id,
            fileName: doc.file_name,
            fileExt: doc.file_ext,
            mimeType: r.mimeType,
            fileSize: r.fileSize ? Number(r.fileSize) : null,
            updatedAt: new Date(doc.updated_at * 1000),
            highlight: toBold(textHighlight?.snippet),
            page: { id: r.pageId, slugId: r.pageSlugId, title: r.pageTitle },
            space: { id: r.spaceId, name: r.spaceName, slug: r.spaceSlug },
          };
        }),
    };
  }

  private async loadSpaces(spaceIds: string[]) {
    const unique = [...new Set(spaceIds)];
    if (!unique.length) return new Map();
    const rows = await this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'logo'])
      .where('id', 'in', unique)
      .execute();
    return new Map(rows.map((s) => [s.id, s]));
  }
}
