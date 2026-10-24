import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PublicSpaceModule } from '../public-space/public-space.module';
import { AttachmentSearchController } from './attachment-search.controller';
import { AttachmentSearchService } from './attachment-search.service';
import { TypesenseClient } from './typesense/typesense.client';
import { TypesenseIndexerService } from './typesense/typesense-indexer.service';
import { TypesenseSearchService } from './typesense/typesense-search.service';
import { TypesenseProcessor } from './typesense/typesense.processor';

@Module({
  imports: [PublicSpaceModule],
  controllers: [SearchController, AttachmentSearchController],
  providers: [
    SearchService,
    AttachmentSearchService,
    TypesenseClient,
    TypesenseIndexerService,
    TypesenseSearchService,
    TypesenseProcessor,
  ],
  exports: [SearchService, AttachmentSearchService, TypesenseSearchService],
})
export class SearchModule {}
