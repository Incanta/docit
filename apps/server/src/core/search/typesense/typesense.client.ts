import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Client } from 'typesense';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';

export const PAGES_COLLECTION = 'docit_pages';
export const ATTACHMENTS_COLLECTION = 'docit_attachments';

export type TypesensePageDoc = {
  id: string;
  workspace_id: string;
  space_id: string;
  slug_id: string;
  title: string;
  text: string;
  icon?: string;
  parent_page_id?: string;
  creator_id?: string;
  label_ids: string[];
  created_at: number;
  updated_at: number;
};

export type TypesenseAttachmentDoc = {
  id: string;
  workspace_id: string;
  space_id: string;
  page_id: string;
  file_name: string;
  file_ext: string;
  text: string;
  updated_at: number;
};

/**
 * Shared Typesense client plus collection setup. Active only when
 * SEARCH_DRIVER=typesense; everything is a no-op otherwise.
 */
@Injectable()
export class TypesenseClient implements OnApplicationBootstrap {
  private readonly logger = new Logger(TypesenseClient.name);
  private client: Client | null = null;

  constructor(
    private readonly environmentService: EnvironmentService,
    @InjectQueue(QueueName.SEARCH_QUEUE) private readonly searchQueue: Queue,
  ) {}

  get enabled(): boolean {
    return this.environmentService.getSearchDriver() === 'typesense';
  }

  get api(): Client {
    if (!this.client) {
      this.client = new Client({
        nodes: [{ url: this.environmentService.getTypesenseUrl() }],
        apiKey: this.environmentService.getTypesenseApiKey(),
        connectionTimeoutSeconds: 10,
        numRetries: 3,
      });
    }
    return this.client;
  }

  // Typed loosely: the client's schema union rejects default_sorting_field.
  private schemas(): any[] {
    const locale = this.environmentService.getTypesenseLocale() || 'en';
    return [
      {
        name: PAGES_COLLECTION,
        fields: [
          { name: 'workspace_id', type: 'string', facet: true },
          { name: 'space_id', type: 'string', facet: true },
          { name: 'slug_id', type: 'string', index: false, optional: true },
          { name: 'title', type: 'string', locale },
          { name: 'text', type: 'string', locale },
          { name: 'icon', type: 'string', index: false, optional: true },
          { name: 'parent_page_id', type: 'string', optional: true },
          { name: 'creator_id', type: 'string', facet: true, optional: true },
          { name: 'label_ids', type: 'string[]', facet: true, optional: true },
          { name: 'created_at', type: 'int64' },
          { name: 'updated_at', type: 'int64', sort: true },
        ],
        default_sorting_field: 'updated_at',
      },
      {
        name: ATTACHMENTS_COLLECTION,
        fields: [
          { name: 'workspace_id', type: 'string', facet: true },
          { name: 'space_id', type: 'string', facet: true },
          { name: 'page_id', type: 'string', facet: true },
          { name: 'file_name', type: 'string', locale },
          { name: 'file_ext', type: 'string', facet: true },
          { name: 'text', type: 'string', locale },
          { name: 'updated_at', type: 'int64', sort: true },
        ],
        default_sorting_field: 'updated_at',
      },
    ];
  }

  /** Create missing collections. Returns true if any were created. */
  async ensureCollections(): Promise<boolean> {
    let created = false;
    for (const schema of this.schemas()) {
      try {
        await this.api.collections(schema.name).retrieve();
      } catch (err: any) {
        if (err?.httpStatus !== 404) throw err;
        await this.api.collections().create(schema);
        created = true;
        this.logger.log(`Created Typesense collection ${schema.name}`);
      }
    }
    return created;
  }

  async onApplicationBootstrap() {
    if (!this.enabled) return;
    try {
      const created = await this.ensureCollections();
      // A fresh index (first start or a wiped server) needs a full load.
      if (created) {
        await this.searchQueue.add(
          QueueJob.SEARCH_INDEX_PAGES,
          { all: true },
          { jobId: 'typesense-initial-reindex' },
        );
      }
    } catch (err) {
      this.logger.error(
        `Typesense is not reachable at ${this.environmentService.getTypesenseUrl()}: ${(err as Error).message}`,
      );
    }
  }
}
