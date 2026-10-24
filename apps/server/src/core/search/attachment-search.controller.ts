import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { AttachmentSearchService } from './attachment-search.service';
import { TypesenseSearchService } from './typesense/typesense-search.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';

export class AttachmentSearchDto {
  @IsString()
  @MaxLength(200)
  query: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('search')
export class AttachmentSearchController {
  constructor(
    private readonly attachmentSearch: AttachmentSearchService,
    private readonly typesenseSearch: TypesenseSearchService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
  ) {}

  /** Admins: extract text from existing attachments (e.g. after upgrading). */
  @HttpCode(HttpStatus.OK)
  @RequireSessionAuth()
  @Post('attachments/reindex')
  async reindex(
    @Body() body: { force?: boolean },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
    await this.attachmentQueue.add(
      QueueJob.ATTACHMENT_INDEXING,
      { workspaceId: workspace.id, force: body?.force === true },
      { jobId: `attachment-indexing-${workspace.id}` },
    );
    return { queued: true };
  }

  /** Full-text search inside attachments (PDF, DOCX, and text files). */
  @HttpCode(HttpStatus.OK)
  @Post('attachments')
  async search(
    @Body() dto: AttachmentSearchDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (dto.spaceId) {
      const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    const opts = {
      query: dto.query,
      spaceId: dto.spaceId,
      limit: dto.limit ?? 10,
      userId: user.id,
      workspaceId: workspace.id,
    };
    if (this.typesenseSearch.enabled) {
      return this.typesenseSearch.searchAttachments(opts);
    }
    return this.attachmentSearch.search(opts);
  }
}
