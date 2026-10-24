import { KyselyDB } from '@docmost/db/types/kysely.types';

/**
 * better-auth database adapter for DocIt.
 *
 * better-auth assumes one global user per email; DocIt users belong to a
 * workspace and the same email can exist in several. Each better-auth
 * instance therefore gets an adapter bound to one workspace, and every
 * query is filtered by it.
 *
 * Model mapping:
 * - user          -> users (DocIt's own table)
 * - account       -> auth_accounts for OAuth/OIDC identities; the
 *                    "credential" account is virtual and reads/writes
 *                    users.password so existing bcrypt hashes keep working
 * - session       -> auth_sessions (short-lived; DocIt issues its own JWT)
 * - verification  -> auth_verifications (OAuth state and similar)
 */

type Where = {
  field: string;
  value: any;
  operator?: string;
  connector?: 'AND' | 'OR';
  mode?: 'sensitive' | 'insensitive';
};

type ModelDef = {
  table: string;
  /** logical field -> column (camelCase; the Kysely plugin snake-cases it) */
  fields: Record<string, string>;
  softDelete?: boolean;
};

const MODELS: Record<string, ModelDef> = {
  user: {
    table: 'users',
    fields: {
      id: 'id',
      name: 'name',
      email: 'email',
      image: 'avatarUrl',
      emailVerified: 'emailVerifiedAt',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    softDelete: true,
  },
  account: {
    table: 'authAccounts',
    fields: {
      id: 'id',
      accountId: 'providerUserId',
      providerId: 'authProviderId',
      userId: 'userId',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
      idToken: 'idToken',
      accessTokenExpiresAt: 'accessTokenExpiresAt',
      refreshTokenExpiresAt: 'refreshTokenExpiresAt',
      scope: 'scope',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    softDelete: true,
  },
  session: {
    table: 'authSessions',
    fields: {
      id: 'id',
      token: 'token',
      userId: 'userId',
      expiresAt: 'expiresAt',
      ipAddress: 'ipAddress',
      userAgent: 'userAgent',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  verification: {
    table: 'authVerifications',
    fields: {
      id: 'id',
      identifier: 'identifier',
      value: 'value',
      expiresAt: 'expiresAt',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
};

export const CREDENTIAL_PROVIDER = 'credential';
const CREDENTIAL_PREFIX = 'credential:';

export type NewUserData = {
  name?: string | null;
  email: string;
  image?: string | null;
  emailVerified?: boolean;
};

export type DocitAdapterDeps = {
  db: KyselyDB;
  workspaceId: string;
  /** Create a workspace member (DocIt sign-up rules apply). */
  createUser: (data: NewUserData) => Promise<{ id: string }>;
};

function modelDef(model: string): ModelDef {
  const def = MODELS[model];
  if (!def) throw new Error(`DocIt auth adapter: unsupported model "${model}"`);
  return def;
}

function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** better-auth where clauses -> Kysely expression. */
function buildWhere(eb: any, model: string, where: Where[] = []) {
  const def = modelDef(model);
  const one = (w: Where) => {
    const column = def.fields[w.field];
    if (!column) throw new Error(`DocIt auth adapter: unknown field ${model}.${w.field}`);
    const op = w.operator ?? 'eq';

    // users.email_verified_at holds a date; better-auth asks for a boolean.
    if (model === 'user' && w.field === 'emailVerified') {
      const truthy = op === 'ne' ? !w.value : !!w.value;
      return eb(column, truthy ? 'is not' : 'is', null);
    }

    const insensitive = w.mode === 'insensitive' && typeof w.value === 'string';
    const ref = insensitive ? eb.fn('lower', [eb.ref(column)]) : eb.ref(column);
    const value = insensitive ? w.value.toLowerCase() : w.value;

    switch (op) {
      case 'eq':
        return value === null ? eb(column, 'is', null) : eb(ref, '=', value);
      case 'ne':
        return value === null ? eb(column, 'is not', null) : eb(ref, '<>', value);
      case 'lt':
        return eb(ref, '<', value);
      case 'lte':
        return eb(ref, '<=', value);
      case 'gt':
        return eb(ref, '>', value);
      case 'gte':
        return eb(ref, '>=', value);
      case 'in':
        return Array.isArray(value) && value.length
          ? eb(ref, 'in', value)
          : eb.val(false);
      case 'not_in':
        return Array.isArray(value) && value.length
          ? eb(ref, 'not in', value)
          : eb.val(true);
      case 'contains':
        return eb(ref, 'like', `%${escapeLike(String(value))}%`);
      case 'starts_with':
        return eb(ref, 'like', `${escapeLike(String(value))}%`);
      case 'ends_with':
        return eb(ref, 'like', `%${escapeLike(String(value))}`);
      default:
        throw new Error(`DocIt auth adapter: unsupported operator ${op}`);
    }
  };

  const ands = where.filter((w) => w.connector !== 'OR').map(one);
  const ors = where.filter((w) => w.connector === 'OR').map(one);
  const parts = [...ands];
  if (ors.length) parts.push(eb.or(ors));
  return parts.length ? eb.and(parts) : eb.val(true);
}

function fromRow(model: string, row: any): any {
  if (!row) return null;
  const def = modelDef(model);
  const out: Record<string, any> = {};
  for (const [field, column] of Object.entries(def.fields)) {
    out[field] = row[column] ?? null;
  }
  if (model === 'user') out.emailVerified = !!row.emailVerifiedAt;
  return out;
}

function toRow(model: string, data: Record<string, any>): Record<string, any> {
  const def = modelDef(model);
  const out: Record<string, any> = {};
  for (const [field, value] of Object.entries(data)) {
    const column = def.fields[field];
    if (!column || value === undefined) continue;
    if (field === 'id' && !value) continue;
    if (model === 'user' && field === 'emailVerified') {
      out.emailVerifiedAt = value ? new Date() : null;
      continue;
    }
    out[column] = value;
  }
  return out;
}

/** Does this query target the virtual credential account? */
export function credentialTarget(where: Where[] = []) {
  const providerClause = where.find((w) => w.field === 'providerId');
  const idClause = where.find(
    (w) => w.field === 'id' && typeof w.value === 'string',
  );
  const isCredential =
    (providerClause &&
      (providerClause.operator ?? 'eq') === 'eq' &&
      providerClause.value === CREDENTIAL_PROVIDER) ||
    (idClause && String(idClause.value).startsWith(CREDENTIAL_PREFIX));
  if (!isCredential) return null;

  const userId =
    where.find((w) => w.field === 'userId')?.value ??
    where.find((w) => w.field === 'accountId')?.value ??
    (idClause ? String(idClause.value).slice(CREDENTIAL_PREFIX.length) : null);
  return { userId: userId ? String(userId) : null };
}

/**
 * Returns the adapter body for better-auth's createAdapterFactory. Kept free
 * of better-auth imports so it can be unit tested under Jest.
 */
export function createDocitAdapter(deps: DocitAdapterDeps) {
  const { db, workspaceId } = deps;
  const anyDb = db as any;

  const scoped = (model: string, qb: any) => {
    const def = modelDef(model);
    let q = qb.where(`${def.table}.workspaceId`, '=', workspaceId);
    if (def.softDelete) q = q.where(`${def.table}.deletedAt`, 'is', null);
    return q;
  };

  const credentialAccount = async (userId: string | null) => {
    if (!userId) return null;
    const user = await anyDb
      .selectFrom('users')
      .select(['id', 'password', 'createdAt', 'updatedAt'])
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user?.password) return null;
    return {
      id: `${CREDENTIAL_PREFIX}${user.id}`,
      accountId: user.id,
      providerId: CREDENTIAL_PROVIDER,
      userId: user.id,
      password: user.password,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  };

  const setPassword = async (userId: string, hash: string) => {
    await anyDb
      .updateTable('users')
      .set({ password: hash, updatedAt: new Date() })
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  };

  const selectRows = (model: string, where: Where[] = []) => {
    const def = modelDef(model);
    return scoped(
      model,
      anyDb
        .selectFrom(def.table)
        .selectAll(def.table)
        .where((eb: any) => buildWhere(eb, model, where)),
    );
  };

  /** OAuth accounts must point at a provider id; strip credential clauses. */
  const oauthWhere = (where: Where[] = []) =>
    where.filter(
      (w) => !(w.field === 'providerId' && w.value === CREDENTIAL_PROVIDER),
    );

  const adapter = {
    async create({ model, data }: { model: string; data: Record<string, any> }) {
      if (model === 'user') {
        const user = await deps.createUser({
          name: data.name,
          email: String(data.email).toLowerCase(),
          image: data.image,
          emailVerified: data.emailVerified,
        });
        return fromRow('user', await selectRows('user', [{ field: 'id', value: user.id }]).executeTakeFirst());
      }
      if (model === 'account' && data.providerId === CREDENTIAL_PROVIDER) {
        await setPassword(data.userId, data.password);
        return credentialAccount(data.userId);
      }
      const def = modelDef(model);
      const row = await anyDb
        .insertInto(def.table)
        .values({ ...toRow(model, data), workspaceId })
        .returningAll()
        .executeTakeFirst();
      return fromRow(model, row);
    },

    async findOne({ model, where }: { model: string; where: Where[] }) {
      if (model === 'account') {
        const cred = credentialTarget(where);
        if (cred) return credentialAccount(cred.userId);
      }
      const row = await selectRows(
        model,
        model === 'account' ? oauthWhere(where) : where,
      ).executeTakeFirst();
      return fromRow(model, row);
    },

    async findMany({
      model,
      where,
      limit,
      offset,
      sortBy,
    }: {
      model: string;
      where?: Where[];
      limit?: number;
      offset?: number;
      sortBy?: { field: string; direction: 'asc' | 'desc' };
    }) {
      if (model === 'account') {
        const cred = credentialTarget(where);
        if (cred) {
          const acc = await credentialAccount(cred.userId);
          return acc ? [acc] : [];
        }
      }
      const def = modelDef(model);
      let q = selectRows(model, model === 'account' ? oauthWhere(where) : where);
      if (sortBy && def.fields[sortBy.field]) {
        q = q.orderBy(def.fields[sortBy.field], sortBy.direction);
      }
      if (limit) q = q.limit(limit);
      if (offset) q = q.offset(offset);
      const rows = (await q.execute()).map((r: any) => fromRow(model, r));

      // Listing a user's accounts includes the password "account".
      const userClause = where?.find((w) => w.field === 'userId');
      if (model === 'account' && userClause && !where?.some((w) => w.field === 'providerId')) {
        const cred = await credentialAccount(String(userClause.value));
        if (cred) rows.push(cred);
      }
      return rows;
    },

    async update({
      model,
      where,
      update,
    }: {
      model: string;
      where: Where[];
      update: Record<string, any>;
    }) {
      if (model === 'account') {
        const cred = credentialTarget(where);
        if (cred) {
          if (cred.userId && update.password) {
            await setPassword(cred.userId, update.password);
          }
          return credentialAccount(cred.userId);
        }
      }
      const def = modelDef(model);
      const values = toRow(model, update);
      if (!Object.keys(values).length) {
        return adapter.findOne({ model, where });
      }
      const row = await scoped(
        model,
        anyDb
          .updateTable(def.table)
          .set(values)
          .where((eb: any) => buildWhere(eb, model, model === 'account' ? oauthWhere(where) : where)),
      )
        .returningAll()
        .executeTakeFirst();
      return fromRow(model, row);
    },

    async updateMany({
      model,
      where,
      update,
    }: {
      model: string;
      where: Where[];
      update: Record<string, any>;
    }) {
      const def = modelDef(model);
      const result = await scoped(
        model,
        anyDb
          .updateTable(def.table)
          .set(toRow(model, update))
          .where((eb: any) => buildWhere(eb, model, where)),
      ).executeTakeFirst();
      return Number(result?.numUpdatedRows ?? 0);
    },

    async delete({ model, where }: { model: string; where: Where[] }) {
      await adapter.deleteMany({ model, where });
    },

    async deleteMany({ model, where }: { model: string; where: Where[] }) {
      if (model === 'user') {
        // Users are removed through DocIt's own member management.
        return 0;
      }
      if (model === 'account' && credentialTarget(where)) return 0;
      const def = modelDef(model);
      const result = await scoped(
        model,
        anyDb
          .deleteFrom(def.table)
          .where((eb: any) => buildWhere(eb, model, model === 'account' ? oauthWhere(where) : where)),
      ).executeTakeFirst();
      return Number(result?.numDeletedRows ?? 0);
    },

    async count({ model, where }: { model: string; where?: Where[] }) {
      const def = modelDef(model);
      const row = await scoped(
        model,
        anyDb
          .selectFrom(def.table)
          .select((eb: any) => eb.fn.countAll().as('count'))
          .where((eb: any) => buildWhere(eb, model, where)),
      ).executeTakeFirst();
      return Number(row?.count ?? 0);
    },
  };
  return adapter;
}
