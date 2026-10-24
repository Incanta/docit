import { type Kysely, sql } from 'kysely';

// DocIt: per-workspace AI provider configuration. Secrets are encrypted
// with the app secret and never returned to clients.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_settings')
    .ifNotExists()
    .addColumn('workspace_id', 'uuid', (col) =>
      col.primaryKey().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('auth_mode', 'text', (col) => col.notNull().defaultTo('api_key'))
    .addColumn('api_key', 'text')
    .addColumn('base_url', 'text')
    .addColumn('chat_model', 'text')
    .addColumn('embedding_provider', 'text')
    .addColumn('embedding_auth_mode', 'text')
    .addColumn('embedding_api_key', 'text')
    .addColumn('embedding_base_url', 'text')
    .addColumn('embedding_model', 'text')
    .addColumn('embedding_dimensions', 'integer')
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ai_settings').ifExists().execute();
}
