import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Source family is no longer in ZModel',()=>{
 const z=readFileSync(new URL('../zenstack/anchor-hierarchy.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(z,/source:\s*\{/);
});
