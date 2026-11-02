import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {decodeLocCache,encodeLocCache} from '../app/loc/runtime-cache-fields.mjs';

test('LOC cache text array preserves all four settings and nested JSON',()=>{
  const data={
    cache_mode:'isr',cache_provider:'https://isr.example.org',
    isr_domains:[{id:'primary',label:'Cloudflare',origin:'https://isr.example.org'},{id:'backup',origin:'https://backup.example.org'}],
    io_limits:{daily:10000,limits:{perPage:200}}
  };
  const cache=encodeLocCache(data);
  assert.equal(cache.length,4);
  assert.deepEqual(decodeLocCache(cache),data);
});

test('cache mode defaults safely and unsupported values cannot be saved',()=>{
  assert.deepEqual(decodeLocCache([]),{
    cache_mode:'cache',cache_provider:'',isr_domains:[],io_limits:{}
  });
  assert.deepEqual(decodeLocCache(['off','','oops','[]']).isr_domains,[]);
  assert.throws(()=>encodeLocCache({
    cache_mode:'unknown',cache_provider:'',isr_domains:[],io_limits:{}
  }),/無效的快取模式/);
});

test('LOC and ISR read the consolidated cache array, not four SQL columns',()=>{
  const root=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const admin=root('app/loc/runtime-config.mjs');
  const api=root('app/api/loc/_numeric-failover.mjs');
  assert.match(admin,/const COLUMNS='id,cache'/);
  assert.doesNotMatch(admin,/updated_at/);
  assert.match(admin,/decodeLocCache/);
  assert.match(admin,/encodeLocCache/);
  assert.match(api,/\.select\('cache'\)/);
  assert.match(api,/decodeLocCache/);
  assert.doesNotMatch(admin+api,/from\('loc_runtime_config'\)/);
});
