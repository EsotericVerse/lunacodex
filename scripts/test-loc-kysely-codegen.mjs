import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateLocKyselyTypes,locKyselyMetadata} from '../app/loc/providers/kysely-codegen.mjs';

test('LOC uses the vendored upstream Kysely code generator for every portable target',async()=>{
  assert.equal(locKyselyMetadata().tables.length,17);
  for(const dialect of ['postgres','mysql','mssql']){
    const output=generateLocKyselyTypes(dialect);
    assert.match(output,/export interface DB/);
    assert.match(output,/lo3rwang_galaxy/);
    assert.match(output,/lo3rwang_anchor/);
    assert.match(output,/ColumnType/);
    const generated=await readFile(`app/loc/generated/kysely/${dialect}.d.ts`,'utf8');
    assert.equal(generated.slice(generated.indexOf('\n')+1),output);
  }
});

test('the selected source remains a direct vendored MIT integration',async()=>{
  const license=await readFile('vendor/kysely-codegen/LICENSE','utf8');
  const source=await readFile('vendor/kysely-codegen/SOURCE.md','utf8');
  assert.match(license,/MIT License/);
  assert.match(source,/RobinBlomberg\/kysely-codegen/);
  assert.match(source,/dacb4fa/);
});
