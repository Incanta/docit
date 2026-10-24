import { type Kysely, sql } from 'kysely';

// DocIt: API key scopes. NULL means a legacy key with full read/write access.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .addColumn('scopes', sql`text[]`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('api_keys').dropColumn('scopes').execute();
}
