import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { AiController } from './ai.controller';
import { AiSettingsController } from './ai-settings.controller';
import { AiService } from './ai.service';
import { AiProviderService } from './providers/ai-provider.service';
import { RetrievalService } from './answers/retrieval.service';
import { EmbeddingStoreService } from './embeddings/embedding-store.service';
import { EmbeddingIndexerService } from './embeddings/embedding-indexer.service';
import { AiQueueProcessor } from './embeddings/ai-queue.processor';

@Module({
  imports: [SearchModule, PageAccessModule],
  controllers: [AiController, AiSettingsController],
  providers: [
    AiService,
    AiProviderService,
    RetrievalService,
    EmbeddingStoreService,
    EmbeddingIndexerService,
    AiQueueProcessor,
  ],
  exports: [AiService, AiProviderService, EmbeddingIndexerService, AiQueueProcessor],
})
export class AiModule {}
