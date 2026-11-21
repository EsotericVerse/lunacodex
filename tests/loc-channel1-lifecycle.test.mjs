import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

test('Channel 1 SQL pool lifetime is exactly one ingestion request',()=>{
  const src=readFileSync(new URL('../app/loc/import/channel1-receiver.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/let connection:any=null/);
  assert.doesNotMatch(src,/if\(connection\)return connection/);
  assert.match(src,/return new Kysely\(\{dialect:new PostgresDialect\(\{pool\}\)\}\)/);
  assert.match(src,/let closing:Promise<void>\|null=null/);
  assert.match(src,/if\(!closing\)closing=db\.destroy\(\)/);
  assert.match(src,/await close\(\)\.catch\(/);
  assert.match(src,/request\.signal\.addEventListener\("abort",onAbort,\{once:true\}\)/);
  assert.match(src,/request\.signal\.removeEventListener\("abort",onAbort\)/);
  assert.match(src,/if\(aborted\(\)\)throw Error\("Channel 1 request aborted"\)/);
});

test('Channel 1 Deno TypeScript parses without adding a runtime dependency',async()=>{
  const src=readFileSync(new URL('../app/loc/import/channel1-receiver.ts',import.meta.url),'utf8');
  const transpiled=await transform(src,{loader:'ts',format:'esm',target:'es2022'});
  assert.ok(transpiled.code.includes('Deno.serve'));
});
