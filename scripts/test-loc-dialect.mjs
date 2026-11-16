import test from 'node:test';
import assert from 'node:assert/strict';
import {Kysely,PostgresDialect} from 'kysely';
import dialect,{createKyselyDialect,requestScopedPool} from '../modules/loc/dialect/index.mjs';
import {createKyselyDialect as legacyFactory} from '../app/loc/providers/kysely-dialects.mjs';
import {requestScopedPool as legacyPool} from '../app/loc/mcp/native-kysely.mjs';

test('loc:dialect exposes the original LOC factory and request-scoped pool',()=>{
  assert.equal(createKyselyDialect,legacyFactory);
  assert.equal(requestScopedPool,legacyPool);
});

test('loc:dialect("pg",URL) creates a Kysely query client without connecting',async()=>{
  const db=dialect('pg','postgresql://localhost/loc_test');
  assert.ok(db instanceof Kysely);
  const compiled=db.selectNoFrom(eb=>eb.val(1).as('connected')).compile();
  assert.match(compiled.sql,/select/i);
  assert.deepEqual(compiled.parameters,[1]);
  await db.destroy();
});

test('loc:dialect rejects other driver IDs and malformed URLs',()=>{
  assert.throws(()=>dialect('postgres','postgresql://localhost/test'),/Unsupported SQL driver/);
  assert.throws(()=>dialect('pg','https://example.invalid/'),/PostgreSQL URL/);
  assert.throws(()=>dialect('pg','not-a-url'),/Invalid database URL/);
  assert.throws(()=>dialect('pg',''),/database URL is required/);
});

test('upstream dialect config does not acquire a connection',()=>{
  const pool={connect(){throw Error('not called')},end(){}};
  assert.ok(createKyselyDialect('postgres',{pool}) instanceof PostgresDialect);
});
