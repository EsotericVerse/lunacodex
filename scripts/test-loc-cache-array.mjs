import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {decodeLocCache,encodeLocCache} from '../app/loc/runtime-cache-fields.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('LOC caches JSONB preserves settings and nested arrays',()=>{
  const value={cache_mode:'isr',cache_provider:'cloudflare',isr_domains:[{id:'cloudflare'}],io_limits:{daily:10000}};
  assert.deepEqual(encodeLocCache(value),value);
  assert.deepEqual(decodeLocCache(value),value);
  assert.deepEqual(decodeLocCache(null),{cache_mode:'cache',cache_provider:'',isr_domains:[],io_limits:{}});
  assert.throws(()=>encodeLocCache({...value,cache_mode:'invalid'}),/無效的快取模式/);
});
test('Runtime and ISR use loc.caches JSONB, never cache text[]',()=>{
  const config=read('app/loc/runtime-config.mjs'),api=read('app/api/loc/_numeric-failover.mjs');
  assert.match(config,/const COLUMNS='id,caches'/);
  assert.match(config,/update\(\{caches\}\)/);
  assert.match(api,/\.select\('caches'\)/);
  assert.doesNotMatch(config+api,/\.select\('cache'\)|loc_runtime_config/);
});