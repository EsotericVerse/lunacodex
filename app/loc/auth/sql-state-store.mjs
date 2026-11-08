// LOC Auth private SQL state, using the same Kysely connection as the trusted
// application backend. No new driver, SQL Gateway, or cloud storage dependency.
// Never expose this adapter through a generic public query endpoint.
const TABLE = 'api.loc_auth';
const KEY = /^[A-Za-z0-9:._-]{1,320}$/;
const BUCKET = /^[A-Za-z0-9._-]{1,64}$/;
const PREFIX = /^[A-Za-z0-9:.-]{1,160}$/;
const ENGINES = new Set(['postgres', 'mysql', 'mssql']);

function affected(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Number(first?.numDeletedRows ?? first?.numUpdatedRows ??
    first?.numAffectedRows ?? 0);
}
function duplicate(error) {
  return error?.code === '23505' || error?.code === 'ER_DUP_ENTRY' ||
    error?.errno === 1062 || error?.number === 2627 || error?.number === 2601;
}
function validKey(value) {
  if (typeof value !== 'string' || !KEY.test(value))
    throw new TypeError('Invalid LOC Auth state key');
  return value;
}
function expiration(value) {
  const n = Number(value?.expires);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function decode(row) {
  if (!row) return undefined;
  if (row.expires_at !== null && Number(row.expires_at) <= Date.now())
    return undefined;
  return JSON.parse(row.value_json);
}
export function createLocAuthSqlState(db, {
  engine = 'postgres', bucket = 'loc-authority-control-v1'
} = {}) {
  if (!db || typeof db.selectFrom !== 'function' || !ENGINES.has(engine) ||
      !BUCKET.test(bucket))
    throw new TypeError('Invalid trusted LOC Auth Kysely store');

  const select = key => db.selectFrom(TABLE)
    .select(['value_json', 'expires_at', 'revision'])
    .where('bucket', '=', bucket).where('state_key', '=', validKey(key));

  async function get(key) {
    return decode(await select(key).executeTakeFirst());
  }
  async function put(key, value) {
    key = validKey(key);
    // The caller supplies only LOC Auth internal records, never a browser JSON
    // or a client-selected table/column. Private key material is pre-encrypted.
    const row = {
      bucket, state_key: key, value_json: JSON.stringify(value),
      expires_at: expiration(value), updated_at: Date.now(),
      revision: crypto.randomUUID()
    };
    if (row.value_json === undefined)
      throw new TypeError('LOC Auth state cannot be undefined');
    const changes = {
      value_json: row.value_json, expires_at: row.expires_at,
      updated_at: row.updated_at, revision: row.revision
    };
    if (engine === 'postgres') {
      await db.insertInto(TABLE).values(row)
        .onConflict(oc => oc.columns(['bucket', 'state_key'])
          .doUpdateSet(changes)).execute();
    } else if (engine === 'mysql') {
      await db.insertInto(TABLE).values(row)
        .onDuplicateKeyUpdate(changes).execute();
    } else {
      // SQL Server: portable optimistic insert/update without MERGE.
      const apply = () => db.updateTable(TABLE).set(changes)
        .where('bucket', '=', bucket).where('state_key', '=', key).execute();
      if (affected(await apply())) return true;
      try { await db.insertInto(TABLE).values(row).execute(); }
      catch (error) {
        if (!duplicate(error)) throw error;
        await apply();
      }
    }
    return true;
  }
  async function take(key) {
    key = validKey(key);
    // Only one concurrent claimant can delete this exact revision.
    // Unlike a read followed by unguarded deletion, this is safe for
    // one-time authorization codes and rotating refresh tokens.
    for (let i = 0; i < 3; i++) {
      const row = await select(key).executeTakeFirst();
      if (!row) return undefined;
      const deleted = await db.deleteFrom(TABLE)
        .where('bucket', '=', bucket).where('state_key', '=', key)
        .where('revision', '=', row.revision).execute();
      if (affected(deleted)) return decode(row);
    }
    return undefined;
  }
  async function remove(key) {
    await db.deleteFrom(TABLE).where('bucket', '=', bucket)
      .where('state_key', '=', validKey(key)).execute();
    return true;
  }
  async function list({prefix = '', limit = 2000} = {}) {
    // All current LOC Auth prefixes are literal ASCII and contain no LIKE
    // wildcard. An empty prefix is allowed only for trusted service routines.
    if (prefix && !PREFIX.test(prefix)) throw new TypeError('Invalid state prefix');
    const size = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 2000)));
    let query = db.selectFrom(TABLE)
      .select(['state_key', 'value_json', 'expires_at'])
      .where('bucket', '=', bucket);
    if (prefix) query = query.where('state_key', 'like', prefix + '%');
    const rows = await query.orderBy('state_key', 'asc').limit(size).execute();
    return new Map(rows.filter(row => !prefix || row.state_key.startsWith(prefix))
      .map(row => [row.state_key, decode(row)]).filter(([, value]) => value !== undefined));
  }
  return Object.freeze({get, put, take, delete: remove, list});
}
