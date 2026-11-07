import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import snapshot from '../zenstack/schema-contract.mjs';
import {schema} from '../zenstack/schema.mjs';

test('generated bundler-safe ZenStack metadata exactly matches fixed JSON schema',()=>{
 const original=JSON.parse(readFileSync(new URL('../zenstack/schema-contract.json',import.meta.url),'utf8'));
 assert.deepEqual(snapshot,original);
 assert.ok(Array.isArray(snapshot.tables)&&snapshot.tables.length>0);
 assert.ok(schema.models.Lo3rwangGalaxy);
 assert.ok(schema.models.LrunesGalaxy);
});
test('Pages function uses static ESM instead of unsupported JSON import attributes',()=>{
 const body=readFileSync(new URL('../zenstack/schema.mjs',import.meta.url),'utf8');
 assert.match(body,/import contract from '\.\/schema-contract\.mjs'/);
 assert.doesNotMatch(body,/with\s*\{\s*type\s*:\s*['"]json['"]/);
});
