import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AuthAccount,
  AuthProvider,
  InsertableAuthProvider,
  UpdatableAuthProvider,
} from '@docmost/db/types/entity.types';

/** SSO providers (auth_providers) and linked identities (auth_accounts). */
@Injectable()
export class SsoRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async listProviders(workspaceId: string): Promise<AuthProvider[]> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async findProvider(
    id: string,
    workspaceId: string,
  ): Promise<AuthProvider | undefined> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async insertProvider(values: InsertableAuthProvider): Promise<AuthProvider> {
    return this.db
      .insertInto('authProviders')
      .values(values)
      .returningAll()
      .executeTakeFirst();
  }

  async updateProvider(
    id: string,
    workspaceId: string,
    values: UpdatableAuthProvider,
  ): Promise<AuthProvider> {
    return this.db
      .updateTable('authProviders')
      .set({ ...values, updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async softDeleteProvider(id: string, workspaceId: string): Promise<void> {
    await this.db
      .updateTable('authProviders')
      .set({ deletedAt: new Date(), isEnabled: false })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async countEnabled(workspaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom('authProviders')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async findAccount(
    authProviderId: string,
    providerUserId: string,
  ): Promise<AuthAccount | undefined> {
    return this.db
      .selectFrom('authAccounts')
      .selectAll()
      .where('authProviderId', '=', authProviderId)
      .where('providerUserId', '=', providerUserId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async linkAccount(opts: {
    userId: string;
    workspaceId: string;
    authProviderId: string;
    providerUserId: string;
  }): Promise<void> {
    await this.db.insertInto('authAccounts').values(opts).execute();
  }
}
