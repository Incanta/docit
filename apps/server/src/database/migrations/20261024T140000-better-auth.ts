import { type Kysely, sql } from 'kysely';

// DocIt: storage for better-auth, which runs sign-in flows. Users stay in
// `users` and OAuth/OIDC identities in `auth_accounts`; better-auth only
// needs its own short-lived sign-in sessions and verification (OAuth state)
// records. Everything is scoped to a workspace.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_accounts')
    .addColumn('access_token', 'text')
    .addColumn('refresh_token', 'text')
    .addColumn('id_token', 'text')
    .addColumn('access_token_expires_at', 'timestamptz')
    .addColumn('refresh_token_expires_at', 'timestamptz')
    .addColumn('scope', 'text')
    .execute();

  await db.schema
    .createTable('auth_sessions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ip_address', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('auth_verifications')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('identifier', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_auth_verifications_identifier')
    .ifNotExists()
    .on('auth_verifications')
    .columns(['workspace_id', 'identifier'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('auth_verifications').ifExists().execute();
  await db.schema.dropTable('auth_sessions').ifExists().execute();
  await db.schema
    .alterTable('auth_accounts')
    .dropColumn('access_token')
    .dropColumn('refresh_token')
    .dropColumn('id_token')
    .dropColumn('access_token_expires_at')
    .dropColumn('refresh_token_expires_at')
    .dropColumn('scope')
    .execute();
}
