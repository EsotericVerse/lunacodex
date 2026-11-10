import test from 'node:test';
import assert from 'node:assert/strict';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

const env={LOC_DB_PROFILE_SERVICE_TOKEN:'test-trusted-service-token-at-least-32-bytes'};
const profile={engine:'postgres',host:'db.example.net',port:5432,
 database:'loc',username:'reader',password:'test-only-password'};
test('Authority-selected SQL aliases reuse the same Kysely pool',async()=>{
 const urls=[];
 const fetchImpl=async url=>{
  urls.push(url);
  return Response.json(profile);
 };
 const primary=await directMcpKysely(env,'',{fetchImpl});
 assert.strictEqual(primary,await directMcpKysely(env,'loc-main',{fetchImpl}));
 const external=await directMcpKysely(env,'office_postgres',{fetchImpl});
 assert.notStrictEqual(external,primary);
 assert.ok(urls.some(url=>url.endsWith('/v1/internal/database/primary')));
 assert.ok(urls.some(url=>url.endsWith('/v1/internal/database/office_postgres')));
 await primary.db.destroy();
 await external.db.destroy();
});

test('invalid aliases and missing trusted service fail closed',async()=>{
 await assert.rejects(directMcpKysely(env,'not/allowed'),
  /Invalid verified database alias/);
 await assert.rejects(directMcpKysely({}),/Trusted LOC profile service is required/);
});

test('local SQL env variables never bootstrap a second connection path',async()=>{
 await assert.rejects(directMcpKysely({
  LOC_DB_CONNECTIONS_JSON:JSON.stringify({loc_main:{engine:'postgres',
   url:'postgresql://old:old@old.example.net:5432/loc'}}),
  LOC_MCP_DB_ALIAS:'loc_main'
 }),/Trusted LOC profile service is required/);
});
