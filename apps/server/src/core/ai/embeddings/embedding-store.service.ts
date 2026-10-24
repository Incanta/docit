import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { isPageEmbeddingsTableExists } from '@docmost/db/helpers/helpers';

export type EmbeddingChunk = {
  chunkIndex: number;
  chunkStart: number;
  chunkLength: number;
  text: string;
  embedding: number[];
};

export type EmbeddingMatch = {
  pageId: string;
  attachmentId: string | null;
  spaceId: string;
  chunkIndex: number;
  text: string;
  score: number;
};

const toVector = (v: number[]) => `[${v.join(',')}]`;

/**
 * Stores page and attachment chunk embeddings in Postgres with pgvector.
 *
 * The table is created at runtime (not in a migration) because pgvector is
 * optional: installs without the extension keep working and AI answers
 * fall back to keyword retrieval.
 *
 * The vector column has no fixed dimension so the embedding model can be
 * changed; rows are always filtered by model name. Search is an exact scan
 * per workspace, which is fine for typical wiki sizes.
 */
@Injectable()
export class EmbeddingStoreService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingStoreService.name);
  private available: boolean | null = null;

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async onApplicationBootstrap() {
    // Only create the table when it already exists or vector is installed;
    // never fail startup over it.
    try {
      await this.ensureTable();
    } catch {
      /* logged in ensureTable */
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    this.available = await isPageEmbeddingsTableExists(this.db);
    return this.available;
  }

  /** Create the extension and table if possible. Returns availability. */
  async ensureTable(): Promise<boolean> {
    if (await isPageEmbeddingsTableExists(this.db)) {
      this.available = true;
      return true;
    }
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(this.db);
      await sql`
        CREATE TABLE IF NOT EXISTS page_embeddings (
          id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
          page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
          space_id uuid NOT NULL,
          workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          attachment_id uuid REFERENCES attachments(id) ON DELETE CASCADE,
          model_name text NOT NULL,
          model_dimensions integer NOT NULL,
          embedding vector NOT NULL,
          chunk_index integer NOT NULL DEFAULT 0,
          chunk_start integer NOT NULL DEFAULT 0,
          chunk_length integer NOT NULL DEFAULT 0,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        )`.execute(this.db);
      await sql`CREATE INDEX IF NOT EXISTS idx_page_embeddings_ws_model
        ON page_embeddings (workspace_id, model_name)`.execute(this.db);
      await sql`CREATE INDEX IF NOT EXISTS idx_page_embeddings_page
        ON page_embeddings (page_id)`.execute(this.db);
      this.available = true;
      this.logger.log('pgvector page_embeddings table is ready');
      return true;
    } catch (err) {
      this.available = false;
      this.logger.warn(
        `pgvector is not available, AI answers will use keyword retrieval only: ${(err as Error).message}`,
      );
      return false;
    }
  }

  async replaceSource(opts: {
    workspaceId: string;
    spaceId: string;
    pageId: string;
    attachmentId?: string | null;
    modelName: string;
    chunks: EmbeddingChunk[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!(await this.isAvailable())) return;
    await this.db.transaction().execute(async (trx) => {
      if (opts.attachmentId) {
        await sql`DELETE FROM page_embeddings WHERE attachment_id = ${opts.attachmentId}`.execute(trx);
      } else {
        await sql`DELETE FROM page_embeddings WHERE page_id = ${opts.pageId} AND attachment_id IS NULL`.execute(trx);
      }
      for (const c of opts.chunks) {
        await sql`
          INSERT INTO page_embeddings
            (page_id, space_id, workspace_id, attachment_id, model_name,
             model_dimensions, embedding, chunk_index, chunk_start, chunk_length, metadata)
          VALUES
            (${opts.pageId}, ${opts.spaceId}, ${opts.workspaceId}, ${opts.attachmentId ?? null},
             ${opts.modelName}, ${c.embedding.length}, ${toVector(c.embedding)}::text::vector,
             ${c.chunkIndex}, ${c.chunkStart}, ${c.chunkLength},
             ${JSON.stringify({ ...(opts.metadata ?? {}), text: c.text })}::text::jsonb)
        `.execute(trx);
      }
    });
  }

  async deleteByPageIds(pageIds: string[]) {
    if (!pageIds.length || !(await this.isAvailable())) return;
    await sql`DELETE FROM page_embeddings WHERE page_id = ANY(${pageIds}::uuid[])`.execute(this.db);
  }

  async deleteByAttachmentId(attachmentId: string) {
    if (!(await this.isAvailable())) return;
    await sql`DELETE FROM page_embeddings WHERE attachment_id = ${attachmentId}`.execute(this.db);
  }

  async deleteBySpaceId(spaceId: string) {
    if (!(await this.isAvailable())) return;
    await sql`DELETE FROM page_embeddings WHERE space_id = ${spaceId}`.execute(this.db);
  }

  async deleteByWorkspaceId(workspaceId: string) {
    if (!(await this.isAvailable())) return;
    await sql`DELETE FROM page_embeddings WHERE workspace_id = ${workspaceId}`.execute(this.db);
  }

  async moveToSpace(pageIds: string[], spaceId: string) {
    if (!pageIds.length || !(await this.isAvailable())) return;
    await sql`UPDATE page_embeddings SET space_id = ${spaceId}, updated_at = now()
      WHERE page_id = ANY(${pageIds}::uuid[])`.execute(this.db);
  }

  /** Nearest chunks by cosine distance within the given spaces. */
  async search(opts: {
    workspaceId: string;
    modelName: string;
    embedding: number[];
    spaceIds: string[];
    limit: number;
  }): Promise<EmbeddingMatch[]> {
    if (!opts.spaceIds.length || !(await this.isAvailable())) return [];
    const vec = toVector(opts.embedding);
    const result = await sql<any>`
      SELECT e.page_id, e.attachment_id, e.space_id, e.chunk_index,
             e.metadata->>'text' AS text,
             1 - (e.embedding <=> ${vec}::text::vector) AS score
      FROM page_embeddings e
      JOIN pages p ON p.id = e.page_id AND p.deleted_at IS NULL
      WHERE e.workspace_id = ${opts.workspaceId}
        AND e.model_name = ${opts.modelName}
        AND e.model_dimensions = ${opts.embedding.length}
        AND e.space_id = ANY(${opts.spaceIds}::uuid[])
        AND e.deleted_at IS NULL
      ORDER BY e.embedding <=> ${vec}::text::vector
      LIMIT ${opts.limit}
    `.execute(this.db);
    // The CamelCasePlugin also renames raw query columns.
    return result.rows.map((r) => ({
      pageId: r.pageId,
      attachmentId: r.attachmentId,
      spaceId: r.spaceId,
      chunkIndex: r.chunkIndex,
      text: r.text ?? '',
      score: Number(r.score),
    }));
  }

  async countForWorkspace(workspaceId: string, modelName: string) {
    if (!(await this.isAvailable())) return { chunks: 0, pages: 0 };
    const r = await sql<any>`
      SELECT count(*)::int AS chunks, count(DISTINCT page_id)::int AS pages
      FROM page_embeddings WHERE workspace_id = ${workspaceId} AND model_name = ${modelName}
    `.execute(this.db);
    return r.rows[0] ?? { chunks: 0, pages: 0 };
  }
}
