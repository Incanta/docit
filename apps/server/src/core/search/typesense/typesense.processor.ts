import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { EventName } from '../../../common/events/event.contants';
import { TypesenseIndexerService } from './typesense-indexer.service';
import { TypesenseClient } from './typesense.client';

/**
 * Keeps Typesense in sync with the search queue events the core emits.
 * Jobs are drained (and ignored) when another search driver is active,
 * since some of them are queued regardless of the driver.
 */
@Processor(QueueName.SEARCH_QUEUE, { concurrency: 2 })
export class TypesenseProcessor extends WorkerHost {
  private readonly logger = new Logger(TypesenseProcessor.name);

  constructor(
    private readonly indexer: TypesenseIndexerService,
    private readonly typesense: TypesenseClient,
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly searchQueue: Queue,
  ) {
    super();
  }

  // Moving pages between spaces changes their space filter.
  @OnEvent(EventName.PAGE_MOVED_TO_SPACE)
  async onMovedToSpace(event: { pageIds?: string[] }) {
    if (!this.typesense.enabled || !event?.pageIds?.length) return;
    await this.searchQueue.add(QueueJob.PAGE_UPDATED, { pageIds: event.pageIds });
  }

  async process(job: Job): Promise<void> {
    if (!this.typesense.enabled) return;
    const data = job.data ?? {};
    try {
      switch (job.name) {
        case QueueJob.PAGE_CREATED:
        case QueueJob.PAGE_UPDATED:
        case QueueJob.PAGE_RESTORED:
        case QueueJob.SEARCH_INDEX_PAGE:
          await this.indexer.indexPages(data.pageIds ?? [data.pageId]);
          return;
        case QueueJob.PAGE_DELETED:
        case QueueJob.PAGE_SOFT_DELETED:
        case QueueJob.SEARCH_REMOVE_PAGE:
          await this.indexer.deletePages(data.pageIds ?? [data.pageId]);
          return;
        case QueueJob.SEARCH_INDEX_ATTACHMENT:
        case QueueJob.SEARCH_REMOVE_ASSET:
          await this.indexer.indexAttachment(data.attachmentId);
          return;
        case QueueJob.SPACE_DELETED:
          await this.indexer.deleteBy('space_id', data.spaceId);
          return;
        case QueueJob.WORKSPACE_DELETED:
          await this.indexer.deleteBy('workspace_id', data.workspaceId);
          return;
        case QueueJob.SEARCH_INDEX_PAGES:
          await this.indexer.reindex(data.all ? undefined : data.workspaceId);
          return;
        default:
          return;
      }
    } catch (err) {
      this.logger.error(
        `Typesense job ${job.name} failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
