import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { embedMany } from 'ai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AiProviderService } from '../providers/ai-provider.service';
import { EmbeddingChunk, EmbeddingStoreService } from './embedding-store.service';

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
// Bound cost and memory for very large documents.
const MAX_CHUNKS_PER_SOURCE = 400;

export function isAiSearchEnabled(settings: unknown): boolean {
  return (settings as any)?.ai?.search === true;
}

@Injectable()
export class EmbeddingIndexerService {
  private readonly logger = new Logger(EmbeddingIndexerService.name);
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly store: EmbeddingStoreService,
    private readonly aiProvider: AiProviderService,
  ) {}

  /** True when this workspace wants and can produce embeddings. */
  async isIndexingEnabled(workspaceId: string): Promise<boolean> {
    const ws = await this.db
      .selectFrom('workspaces')
      .select('settings')
      .where('id', '=', workspaceId)
      .executeTakeFirst();
    if (!ws || !isAiSearchEnabled(ws.settings)) return false;
    if (!(await this.store.isAvailable())) return false;
    const cfg = await this.aiProvider.resolveConfig(workspaceId);
    return !!cfg.embedding;
  }

  async chunkText(text: string): Promise<{ text: string; start: number }[]> {
    const docs = await this.splitter.createDocuments([text]);
    const chunks: { text: string; start: number }[] = [];
    let cursor = 0;
    for (const d of docs.slice(0, MAX_CHUNKS_PER_SOURCE)) {
      const found = text.indexOf(d.pageContent.slice(0, 50), cursor);
      const start = found >= 0 ? found : cursor;
      chunks.push({ text: d.pageContent, start });
      cursor = Math.max(cursor, start);
    }
    return chunks;
  }

  private async embedChunks(
    workspaceId: string,
    title: string,
    text: string,
  ): Promise<{ modelName: string; chunks: EmbeddingChunk[] } | null> {
    const em = await this.aiProvider.getEmbeddingModel(workspaceId);
    if (!em) return null;

    const pieces = await this.chunkText(text);
    if (pieces.length === 0) return { modelName: em.name, chunks: [] };

    // Prefix the title so short chunks keep their context.
    const values = pieces.map((p) => `${title}\n\n${p.text}`);
    const { embeddings } = await embedMany({
      model: em.model,
      values,
      maxParallelCalls: 2,
      ...(em.dimensions
        ? {
            providerOptions: {
              openai: { dimensions: em.dimensions },
              google: { outputDimensionality: em.dimensions },
            },
          }
        : {}),
    });

    return {
      modelName: em.name,
      chunks: pieces.map((p, i) => ({
        chunkIndex: i,
        chunkStart: p.start,
        chunkLength: p.text.length,
        text: p.text,
        embedding: embeddings[i],
      })),
    };
  }

  async indexPage(pageId: string): Promise<void> {
    const page = await this.db
      .selectFrom('pages')
      .select(['id', 'title', 'textContent', 'spaceId', 'workspaceId', 'deletedAt'])
      .where('id', '=', pageId)
      .executeTakeFirst();
    if (!page) return;
    if (page.deletedAt) {
      await this.store.deleteByPageIds([page.id]);
      return;
    }
    if (!(await this.isIndexingEnabled(page.workspaceId))) return;

    const title = page.title || 'Untitled';
    const text = `${title}\n\n${page.textContent ?? ''}`.trim();
    const result = await this.embedChunks(page.workspaceId, title, text);
    if (!result) return;

    await this.store.replaceSource({
      workspaceId: page.workspaceId,
      spaceId: page.spaceId,
      pageId: page.id,
      modelName: result.modelName,
      chunks: result.chunks,
      metadata: { title },
    });
  }

  async indexAttachment(attachmentId: string): Promise<void> {
    const att = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'fileName',
        'textContent',
        'pageId',
        'spaceId',
        'workspaceId',
        'deletedAt',
      ])
      .where('id', '=', attachmentId)
      .executeTakeFirst();
    if (!att || !att.pageId || !att.spaceId) return;
    if (att.deletedAt || !att.textContent) {
      await this.store.deleteByAttachmentId(att.id);
      return;
    }
    if (!(await this.isIndexingEnabled(att.workspaceId))) return;

    const result = await this.embedChunks(
      att.workspaceId,
      att.fileName,
      att.textContent,
    );
    if (!result) return;
    await this.store.replaceSource({
      workspaceId: att.workspaceId,
      spaceId: att.spaceId,
      pageId: att.pageId,
      attachmentId: att.id,
      modelName: result.modelName,
      chunks: result.chunks,
      metadata: { title: att.fileName, attachment: true },
    });
  }

  /** Page ids (and indexed attachment ids) to embed for a whole workspace. */
  async listWorkspaceSources(workspaceId: string) {
    const pages = await this.db
      .selectFrom('pages')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    const attachments = await this.db
      .selectFrom('attachments')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('textContent', 'is not', null)
      .where('pageId', 'is not', null)
      .execute();
    return {
      pageIds: pages.map((p) => p.id),
      attachmentIds: attachments.map((a) => a.id),
    };
  }
}
