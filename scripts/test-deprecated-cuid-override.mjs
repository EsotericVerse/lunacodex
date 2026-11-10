import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));

test('deprecated cuid@3 is replaced only at npm dependency resolution',()=>{
  assert.equal(manifest.dependencies.cuid,undefined);
  assert.equal(manifest.overrides.cuid,'npm:@paralleldrive/cuid2@2.3.1');
  const replacement=lock.packages['node_modules/cuid'];
  assert.equal(replacement?.name,'@paralleldrive/cuid2');
  assert.equal(replacement?.version,'2.3.1');
  assert.equal(replacement?.integrity,lock.packages['node_modules/@paralleldrive/cuid2']?.integrity);
  assert.match(replacement?.resolved??'',/\/\@paralleldrive\/cuid2\/-\/cuid2-2\.3\.1\.tgz$/);
  assert.equal(replacement?.deprecated,undefined);
});

test('ZenStack ORM remains importable after replacing deprecated cuid',async()=>{
  const {ZenStackClient}=await import('@zenstackhq/orm');
  assert.equal(typeof ZenStackClient,'function');
});
