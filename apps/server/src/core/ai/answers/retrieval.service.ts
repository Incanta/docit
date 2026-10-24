import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { embed } from 'ai';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { SearchService } from '../../search/search.service';
import { AiProviderService } from '../providers/ai-provider.service';
import { EmbeddingStoreService } from '../embeddings/embedding-store.service';

export type RetrievedSource = {
  index: number;
  pageId: string;
  slugId: string;
  title: string;
  spaceId: string;
  spaceName?: string;
  attachmentName?: string;
  snippets: string[];
};

const MAX_SOURCES = 8;
const MAX_SNIPPETS_PER_SOURCE = 3;
const SNIPPET_CHARS = 1500;
const MAX_CONTEXT_CHARS = 28_000;

/**
 * Finds the passages an AI answer is grounded in. Combines vector search
 * (when an embedding model and pgvector are available) with the regular
 * full-text search, and only ever returns pages the user can read.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly searchService: SearchService,
    private readonly aiProvider: AiProviderService,
    private readonly store: EmbeddingStoreService,
  ) {}

  async retrieve(opts: {
    query: string;
    userId: string;
    workspaceId: string;
    spaceId?: string;
  }): Promise<{ sources: RetrievedSource[]; usedVectors: boolean }> {
    const { query, userId, workspaceId, spaceId } = opts;
    const memberSpaces = await this.spaceMemberRepo.getUserSpaceIds(userId);
    const spaceIds = spaceId
      ? memberSpaces.filter((id) => id === spaceId)
      : memberSpaces;
    if (spaceIds.length === 0) return { sources: [], usedVectors: false };

    // pageId -> ordered snippets (and attachment label, if any)
    const byPage = new Map<string, { snippets: string[]; score: number; attachmentId?: string }>();
    const add = (pageId: string, text: string, score: number, attachmentId?: string) => {
      const entry = byPage.get(pageId) ?? { snippets: [], score: 0, attachmentId };
      if (entry.snippets.length < MAX_SNIPPETS_PER_SOURCE && text.trim()) {
        entry.snippets.push(text.slice(0, SNIPPET_CHARS));
      }
      entry.score = Math.max(entry.score, score);
      byPage.set(pageId, entry);
    };

    let usedVectors = false;
    try {
      const em = await this.aiProvider.getEmbeddingModel(workspaceId);
      if (em && (await this.store.isAvailable())) {
        const { embedding } = await embed({ model: em.model, value: query });
        const matches = await this.store.search({
          workspaceId,
          modelName: em.name,
          embedding,
          spaceIds,
          limit: 30,
        });
        usedVectors = matches.length > 0;
        // Nearest neighbours always return something; drop weak matches
        // relative to the best one so unrelated pages are not cited.
        const top = matches[0]?.score ?? 0;
        const relevant = matches.filter((m) => m.score >= top * 0.8);
        for (const m of relevant) {
          add(m.pageId, m.text, m.score, m.attachmentId ?? undefined);
        }
      }
    } catch (err) {
      this.logger.warn(`Vector retrieval failed, using keyword search: ${(err as Error).message}`);
    }

    // Keyword search runs too: it catches exact names that vectors miss.
    const keyword = await this.searchService.searchPage(
      { query: toKeywordQuery(query), spaceId, limit: 8 } as any,
      { userId, workspaceId },
    );
    const keywordIds = keyword.items.map((r: any) => r.id);
    if (keywordIds.length) {
      const pages = await this.db
        .selectFrom('pages')
        .select(['id', 'textContent', 'title'])
        .where('id', 'in', keywordIds)
        .execute();
      const terms = queryTerms(query);
      keywordIds.forEach((id, rank) => {
        const page = pages.find((p) => p.id === id);
        if (!page) return;
        for (const snippet of bestPassages(page.textContent ?? '', terms)) {
          add(id, snippet, 0.5 - rank * 0.02);
        }
        if (!byPage.get(id)?.snippets.length) add(id, page.title ?? '', 0.3);
      });
    }

    if (byPage.size === 0) return { sources: [], usedVectors };

    // Enforce page-level restrictions on everything we found.
    const accessible = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: [...byPage.keys()],
        userId,
        spaceId,
      }),
    );

    const ranked = [...byPage.entries()]
      .filter(([pageId]) => accessible.has(pageId))
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, MAX_SOURCES);
    if (ranked.length === 0) return { sources: [], usedVectors };

    const meta = await this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.spaceId',
        'spaces.name as spaceName',
      ])
      .where('pages.id', 'in', ranked.map(([id]) => id))
      .where('pages.deletedAt', 'is', null)
      .execute();
    const attachmentIds = ranked
      .map(([, v]) => v.attachmentId)
      .filter(Boolean) as string[];
    const attachments = attachmentIds.length
      ? await this.db
          .selectFrom('attachments')
          .select(['id', 'fileName'])
          .where('id', 'in', attachmentIds)
          .execute()
      : [];

    let budget = MAX_CONTEXT_CHARS;
    const sources: RetrievedSource[] = [];
    for (const [pageId, v] of ranked) {
      const m = meta.find((p) => p.id === pageId);
      if (!m) continue;
      const snippets: string[] = [];
      for (const s of v.snippets) {
        if (budget - s.length < 0) break;
        budget -= s.length;
        snippets.push(s);
      }
      if (!snippets.length) continue;
      sources.push({
        index: sources.length + 1,
        pageId,
        slugId: m.slugId,
        title: m.title || 'Untitled',
        spaceId: m.spaceId,
        spaceName: m.spaceName ?? undefined,
        attachmentName: attachments.find((a) => a.id === v.attachmentId)?.fileName,
        snippets,
      });
    }
    return { sources, usedVectors };
  }
}

const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from how i in is it of on or our the this to was we what when where which who why will with you your'.split(' '),
);

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
    ),
  ];
}

/**
 * Questions rarely match full-text AND semantics, so OR the key terms
 * (pg-tsquery syntax) and let ranking sort it out.
 */
function toKeywordQuery(query: string): string {
  const terms = queryTerms(query);
  return (terms.length ? terms.slice(0, 8).join(' | ') : query).slice(0, 200);
}

/** Pick the windows of text with the most query-term hits. */
function bestPassages(text: string, terms: string[], count = 2): string[] {
  if (!text) return [];
  if (text.length <= SNIPPET_CHARS) return [text];
  const windows: { start: number; hits: number }[] = [];
  const lower = text.toLowerCase();
  const step = Math.floor(SNIPPET_CHARS / 2);
  for (let start = 0; start < text.length; start += step) {
    const slice = lower.slice(start, start + SNIPPET_CHARS);
    const hits = terms.reduce((n, t) => n + (slice.includes(t) ? 1 : 0), 0);
    windows.push({ start, hits });
  }
  windows.sort((a, b) => b.hits - a.hits || a.start - b.start);
  const picked: number[] = [];
  for (const w of windows) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p - w.start) < SNIPPET_CHARS)) continue;
    picked.push(w.start);
  }
  if (!picked.length) picked.push(0);
  return picked.sort((a, b) => a - b).map((s) => text.slice(s, s + SNIPPET_CHARS));
}
