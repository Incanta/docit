import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { sql } from 'kysely';
import * as mammoth from 'mammoth';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';

/** File types whose text DocIt extracts for search. */
export const INDEXABLE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv'];

// Large files cost a lot to parse and rarely help search beyond the start.
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;

export function isIndexable(fileExt: string | null | undefined): boolean {
  return INDEXABLE_EXTENSIONS.includes((fileExt ?? '').toLowerCase());
}

/** Pull plain text out of a supported document. */
export async function extractAttachmentText(
  fileExt: string,
  buffer: Buffer,
): Promise<string> {
  switch (fileExt.toLowerCase()) {
    case '.pdf': {
      // unpdf bundles a serverless build of pdf.js; load it lazily.
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      try {
        const { text } = await extractText(pdf, { mergePages: true });
        return text;
      } finally {
        // Free the worker-side document; the method is not in unpdf's types.
        await (pdf as any).destroy?.();
      }
    }
    case '.docx': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case '.txt':
    case '.md':
    case '.csv':
      return buffer.toString('utf8');
    default:
      return '';
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

@Injectable()
export class AttachmentIndexService {
  private readonly logger = new Logger(AttachmentIndexService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    private readonly environmentService: EnvironmentService,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly searchQueue: Queue,
  ) {}

  async indexAttachment(attachmentId: string): Promise<void> {
    const att = await this.db
      .selectFrom('attachments')
      .select(['id', 'fileName', 'fileExt', 'filePath', 'fileSize', 'deletedAt'])
      .where('id', '=', attachmentId)
      .executeTakeFirst();
    if (!att || att.deletedAt || !isIndexable(att.fileExt)) return;

    if (Number(att.fileSize ?? 0) > MAX_FILE_BYTES) {
      this.logger.debug(`Skipping large attachment ${att.id} for indexing`);
      return;
    }

    let text = '';
    try {
      const buffer = await this.storageService.read(att.filePath);
      text = normalizeText(await extractAttachmentText(att.fileExt, buffer));
    } catch (err) {
      this.logger.warn(
        `Could not extract text from attachment ${att.id} (${att.fileName}): ${(err as Error).message}`,
      );
      return;
    }

    await sql`
      UPDATE attachments SET
        text_content = ${text || null},
        tsv = setweight(to_tsvector('english', f_unaccent(coalesce(file_name, ''))), 'A') ||
              setweight(to_tsvector('english', f_unaccent(${text})), 'B')
      WHERE id = ${att.id}
    `.execute(this.db);

    if (text) {
      // Keep the AI and Typesense indexes in step; both skip work when
      // their feature is off.
      await this.aiQueue
        .add(
          'generate-attachment-embeddings',
          { attachmentId: att.id },
          { jobId: `embed-attachment-${att.id}`, delay: 5_000 },
        )
        .catch(() => undefined);
      if (this.environmentService.getSearchDriver() === 'typesense') {
        await this.searchQueue
          .add(QueueJob.SEARCH_INDEX_ATTACHMENT, { attachmentId: att.id })
          .catch(() => undefined);
      }
    }
  }

  /** Index every supported attachment in a workspace that has no text yet. */
  async indexWorkspace(workspaceId: string, opts: { force?: boolean } = {}) {
    let query = this.db
      .selectFrom('attachments')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('pageId', 'is not', null)
      .where(sql<boolean>`lower(file_ext) = ANY(${INDEXABLE_EXTENSIONS}::text[])`);
    if (!opts.force) query = query.where('textContent', 'is', null);

    const rows = await query.execute();
    this.logger.log(`Indexing ${rows.length} attachments in ${workspaceId}`);
    for (const row of rows) {
      await this.indexAttachment(row.id);
    }
    return rows.length;
  }
}
