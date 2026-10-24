import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { EmbeddingIndexerService } from './embedding-indexer.service';
import { EmbeddingStoreService } from './embedding-store.service';

// Collab saves arrive often while someone types; wait for a quiet period.
const PAGE_EMBED_DELAY_MS = 30_000;
const ATTACHMENT_EMBED_JOB = 'generate-attachment-embeddings';

type PageIdsJob = { pageIds: string[]; workspaceId: string; spaceId?: string };

/**
 * Consumes AI queue events the core already emits (page lifecycle, space and
 * workspace changes, AI search toggles) and keeps embeddings up to date.
 */
@Processor(QueueName.AI_QUEUE, { concurrency: 2 })
export class AiQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AiQueueProcessor.name);

  constructor(
    private readonly indexer: EmbeddingIndexerService,
    private readonly store: EmbeddingStoreService,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
  ) {
    super();
  }

  private async schedulePages(pageIds: string[], delay = PAGE_EMBED_DELAY_MS) {
    for (const pageId of pageIds) {
      // A fixed job id collapses repeated edits into one pending job.
      await this.aiQueue.add(
        QueueJob.GENERATE_PAGE_EMBEDDINGS,
        { pageId },
        { jobId: `embed-page-${pageId}`, delay },
      );
    }
  }

  async scheduleAttachment(attachmentId: string) {
    await this.aiQueue.add(
      ATTACHMENT_EMBED_JOB,
      { attachmentId },
      { jobId: `embed-attachment-${attachmentId}`, delay: 5_000 },
    );
  }

  async process(job: Job): Promise<void> {
    try {
      await this.handle(job);
    } catch (err) {
      this.logger.error(
        `AI job ${job.name} failed: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      throw err;
    }
  }

  private async handle(job: Job) {
    const data = job.data as any;
    switch (job.name) {
      case QueueJob.PAGE_CREATED:
      case QueueJob.PAGE_CONTENT_UPDATED:
      case QueueJob.PAGE_RESTORED: {
        const { pageIds, workspaceId } = data as PageIdsJob;
        if (await this.indexer.isIndexingEnabled(workspaceId)) {
          await this.schedulePages(pageIds);
        }
        return;
      }
      case QueueJob.PAGE_SOFT_DELETED:
      case QueueJob.PAGE_DELETED:
        await this.store.deleteByPageIds((data as PageIdsJob).pageIds);
        return;
      case QueueJob.PAGE_MOVED_TO_SPACE: {
        const { pageIds, spaceId } = data as PageIdsJob;
        await this.store.moveToSpace(pageIds, spaceId);
        return;
      }
      case QueueJob.SPACE_DELETED:
        await this.store.deleteBySpaceId(data.spaceId);
        return;
      case QueueJob.WORKSPACE_DELETED:
        await this.store.deleteByWorkspaceId(data.workspaceId);
        return;

      case QueueJob.GENERATE_PAGE_EMBEDDINGS:
        await this.indexer.indexPage(data.pageId);
        return;
      case ATTACHMENT_EMBED_JOB:
        await this.indexer.indexAttachment(data.attachmentId);
        return;
      case QueueJob.DELETE_PAGE_EMBEDDINGS:
        await this.store.deleteByPageIds(data.pageIds ?? [data.pageId]);
        return;

      case QueueJob.WORKSPACE_CREATE_EMBEDDINGS:
        await this.backfillWorkspace(data.workspaceId);
        return;
      case QueueJob.WORKSPACE_RESET_EMBEDDINGS:
        await this.store.deleteByWorkspaceId(data.workspaceId);
        await this.backfillWorkspace(data.workspaceId);
        return;
      case QueueJob.WORKSPACE_DELETE_EMBEDDINGS:
        // Queued with a delay when AI search is turned off; skip if it was
        // turned back on in the meantime.
        if (!(await this.indexer.isIndexingEnabled(data.workspaceId))) {
          await this.store.deleteByWorkspaceId(data.workspaceId);
        }
        return;
      default:
        return;
    }
  }

  private async backfillWorkspace(workspaceId: string) {
    await this.store.ensureTable();
    if (!(await this.indexer.isIndexingEnabled(workspaceId))) {
      this.logger.log(
        `Skipping embedding backfill for ${workspaceId}: AI search or embedding model not configured`,
      );
      return;
    }
    const { pageIds, attachmentIds } =
      await this.indexer.listWorkspaceSources(workspaceId);
    this.logger.log(
      `Queueing embeddings for ${pageIds.length} pages and ${attachmentIds.length} attachments in ${workspaceId}`,
    );
    await this.schedulePages(pageIds, 0);
    for (const id of attachmentIds) await this.scheduleAttachment(id);
  }
}
