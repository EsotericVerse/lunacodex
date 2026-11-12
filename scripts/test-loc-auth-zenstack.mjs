import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RAINBOW_TABLES} from '../workers/loc-authority/rainbow-tables.mjs';
import {rainbowSchema,RAINBOW_CORE_MODELS} from '../workers/loc-authority/rainbow-zmodel.mjs';
import {validateRainbowRecord,rainbowDatabaseHooks} from '../workers/loc-authority/rainbow-validation.mjs';
import {checkLocAuthEnvironment} from '../workers/loc-authority/auth.mjs';

test('ZenStack mirrors the existing Better Auth core tables, never adds a database schema',()=>{
  assert.equal(Object.keys(RAINBOW_TABLES).length,12);
  assert.deepEqual(Object.keys(RAINBOW_CORE_MODELS),['user','session','account','verification']);
  for(const [key,modelName] of Object.entries(RAINBOW_CORE_MODELS)){
    const model=rainbowSchema.models[modelName];
    assert.ok(model,'missing '+key);
    assert.deepEqual(model.idFields,['id']);
    assert.equal(model.attributes.find(a=>a.name==='@@map').args[0].value.value,
      RAINBOW_TABLES[key]);
    assert.equal(model.attributes.find(a=>a.name==='@@schema').args[0].value.value,
      'public');
  }
  assert.equal(rainbowSchema.provider.defaultSchema,'public');
  assert.deepEqual(rainbowSchema.plugins,{});
});

test('Zod validates Better Auth user/session/account without removing provider fields',async()=>{
  const user={email:'a@example.com',name:'Alice',emailVerified:true,
    providerExtension:{foo:'bar'}};
  assert.deepEqual(await rainbowDatabaseHooks.user.create.before(user),{data:user});
  const session={userId:'user-1',token:'opaque-session',expiresAt:new Date('2030-01-01T00:00:00Z'),
    additionalField:'preserved'};
  assert.deepEqual(await rainbowDatabaseHooks.session.create.before(session),{data:session});
  const account={userId:'user-1',accountId:'google-1',providerId:'google',
    refreshToken:'secret-stays-in-better-auth'};
  assert.deepEqual(await rainbowDatabaseHooks.account.create.before(account),{data:account});
  assert.throws(()=>validateRainbowRecord('user',{email:'invalid'}),/Invalid LOC Auth user fields/);
  assert.throws(()=>validateRainbowRecord('session',{userId:42}),/Invalid LOC Auth session fields/);
  assert.throws(()=>validateRainbowRecord('account',{providerId:42}),/Invalid LOC Auth account fields/);
  assert.throws(()=>validateRainbowRecord('session',null),/Invalid LOC Auth session record/);
  assert.throws(()=>validateRainbowRecord('jwks',{}),/Unknown LOC Auth model/);
});

test('Zod validates config without a database connection, migration or network call',()=>{
  const env={
    LOC_AUTH_DATABASE_URL:'postgresql://user:password@db.example.org/rainbow',
    BETTER_AUTH_SECRET:'x'.repeat(40),
    LOC_GOOGLE_CLIENT_ID:'client-id',
    LOC_GOOGLE_CLIENT_SECRET:'client-secret'
  };
  assert.equal(checkLocAuthEnvironment(env),true);
  assert.throws(()=>checkLocAuthEnvironment({...env,LOC_AUTH_SCHEMA:'loc_auth'}),
    /Rainbow tables are in the public PostgreSQL schema/);
  assert.throws(()=>checkLocAuthEnvironment({...env,BETTER_AUTH_SECRET:'short'}),
    /valid PostgreSQL and OAuth credentials/);
  assert.throws(()=>checkLocAuthEnvironment({...env,LOC_AUTH_DATABASE_URL:'sqlite:bad'}),
    /valid PostgreSQL and OAuth credentials/);
  const auth=readFileSync(new URL('../workers/loc-authority/auth.mjs',import.meta.url),'utf8');
  assert.match(auth,/new PostgresDialect\(\{pool\}\)/);
  assert.match(auth,/databaseHooks:rainbowDatabaseHooks/);
  assert.match(auth,/storeSessionInDatabase:true/);
  assert.match(auth,/cookieCache:locAuthSessionCache\(env\)/);
  assert.doesNotMatch(auth,/runMigrations|CREATE TABLE|ALTER TABLE|DROP TABLE|createAdapterFactory/);
});
