import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('LOC no longer exports or binds the legacy LocCompute Durable Object',async()=>{
  const worker=await read('workers/loc-worker.mjs');
  const config=await read('wrangler.jsonc');
  await assert.rejects(access(new URL('../workers/loc-compute.mjs',import.meta.url)));
  assert.doesNotMatch(worker,/LocCompute|loc-compute/);
  assert.ok(!config.includes('"durable_objects"'));
  assert.ok(config.includes('"tag":"loc-compute-v1","new_sqlite_classes":["LocCompute"]'));
  assert.ok(config.includes('"tag":"loc-compute-v2","deleted_classes":["LocCompute"]'));
});
