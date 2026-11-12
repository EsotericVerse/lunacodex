import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const source=readFileSync(new URL('../workers/loc-isr/wrangler.jsonc',import.meta.url),'utf8');
const data=JSON.parse(source.replace(/^\s*\/\/.*$/gm,''));
const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('loc-isr deployment retains its exact Worker identity and service binding',()=>{
  assert.equal(data.name,'loc-isr');
  assert.equal(data.main,'../../.open-next/worker.js');
  assert.deepEqual(data.compatibility_flags,['nodejs_compat']);
  assert.deepEqual(data.services,[{
    binding:'WORKER_SELF_REFERENCE',service:'loc-isr',environment:'production'
  }]);
  assert.deepEqual(data.assets,{directory:'../../.open-next/assets',binding:'ASSETS'});
});

test('no preview / workers.dev or site-wide Cloudflare adapter is introduced',()=>{
  assert.equal(data.workers_dev,false);
  assert.equal(data.preview_urls,false);
  assert.equal(existsSync(new URL('../wrangler.jsonc',import.meta.url)),false);
  assert.equal(existsSync(new URL('../open-next.config.ts',import.meta.url)),false);
  assert.equal(packageJson.devDependencies?.['@opennextjs/cloudflare'],undefined);
  assert.equal(packageJson.devDependencies?.wrangler,undefined);
});

test('loc-isr adapter config is explicit, not inferred from LOC package name',()=>{
  assert.match(readFileSync(new URL('../workers/loc-isr/open-next.config.ts',import.meta.url),'utf8'),/defineCloudflareConfig/);
  assert.notEqual(packageJson.name,'loc-isr');
});
