import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const generated=[
  'app/i18n/page-locale-manifest.js',
  'packages/zenstack/schema-contract.mjs',
  'next-env.d.ts',
  'public/i18n/pages/',
  'public/i18n/shared/'
];

test('regenerated LOC files stay outside the Git index',()=>{
  for(const name of generated){
    const tracked=execFileSync('git',['ls-files','--',name],{cwd:root,encoding:'utf8'});
    assert.equal(tracked.trim(),'','generated file unexpectedly tracked: '+name);
    const ignored=execFileSync('git',['check-ignore','--',name],{cwd:root,encoding:'utf8'});
    assert.ok(ignored.trim(),'generated file not ignored: '+name);
  }
});

test('prepare generates both required runtime adapter modules before tests',()=>{
  const manifest=fileURLToPath(new URL('../app/i18n/page-locale-manifest.js',import.meta.url));
  const contract=fileURLToPath(new URL('../packages/zenstack/schema-contract.mjs',import.meta.url));
  assert.ok(existsSync(manifest),'page locale manifest must be generated before reading the UI');
  assert.ok(existsSync(contract),'ZenStack contract module must be generated before imports');
  assert.match(readFileSync(manifest,'utf8'),/PAGE_LOCALE_ALIASES/);
  assert.match(readFileSync(contract,'utf8'),/^\/\/ Generated from schema-contract\.json/m);
});
