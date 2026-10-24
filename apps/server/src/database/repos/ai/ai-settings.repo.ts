import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiSettings,
  InsertableAiSettings,
} from '@docmost/db/types/entity.types';

@Injectable()
export class AiSettingsRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<AiSettings | undefined> {
    return this.db
      .selectFrom('aiSettings')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async upsert(values: InsertableAiSettings): Promise<AiSettings> {
    const { workspaceId, ...rest } = values;
    return this.db
      .insertInto('aiSettings')
      .values(values)
      .onConflict((oc) =>
        oc.column('workspaceId').doUpdateSet({ ...rest, updatedAt: new Date() }),
      )
      .returningAll()
      .executeTakeFirst();
  }

  async delete(workspaceId: string): Promise<void> {
    await this.db
      .deleteFrom('aiSettings')
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
