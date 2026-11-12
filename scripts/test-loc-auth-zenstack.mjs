import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RAINBOW_TABLES} from '../workers/loc-authority/rainbow-tables.mjs';
import {rainbowSchema,RAINBOW_MODEL_NAMES,RAINBOW_CORE_MODELS} from '../workers/loc-authority/rainbow-zmodel.mjs';
import {createSchemaFactory} from '@zenstackhq/zod';
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

test('ZenStack Zod factory sees all twelve Rainbow models and Admin fields',()=>{
  const factory=createSchemaFactory(rainbowSchema);
  assert.equal(Object.keys(rainbowSchema.models).length,12);
  for(const modelName of Object.values(RAINBOW_MODEL_NAMES)){
    const pascal=modelName[0].toUpperCase()+modelName.slice(1);
    assert.ok(factory.makeModelSchema(pascal).shape.id);
  }
  const user=factory.makeModelSchema(RAINBOW_CORE_MODELS.user,{optionality:'defaults'});
  const session=factory.makeModelSchema(RAINBOW_CORE_MODELS.session,{optionality:'defaults'});
  for(const field of ['role','banned','banReason','banExpires'])
    assert.ok(user.shape[field]);
  assert.ok(session.shape.impersonatedBy);
  assert.equal(user.shape.email.safeParse(42).success,false);
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
  assert.match(auth,/database:zenstackAdapter\(db,/);
  assert.doesNotMatch(auth,/databaseHooks:rainbowDatabaseHooks/);
  assert.match(auth,/storeSessionInDatabase:true/);
  assert.match(auth,/cookieCache:locAuthSessionCache\(env\)/);
  assert.doesNotMatch(auth,/runMigrations|CREATE TABLE|ALTER TABLE|DROP TABLE|createAdapterFactory/);
});

test('OAuth issuance checks revoked Better Auth Sessions only on demand',()=>{
  const auth=readFileSync(new URL('../workers/loc-authority/auth.mjs',import.meta.url),'utf8');
  const entry=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
  assert.match(auth,/getAuthoritativeSessionFromCtx/);
  for(const route of ['/oauth2/authorize','/oauth2/consent','/oauth2/continue'])
    assert.ok(auth.includes("'"+route+"'"),'OAuth guard missing '+route);
  assert.match(auth,/if\(!token\)return/);
  assert.match(auth,/OAuth Session expired or revoked/);
  assert.doesNotMatch(auth,/setInterval|setTimeout/);
  assert.doesNotMatch(entry,/detail:String\(error|detail:String\(fatal/);
});
