import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Galaxy and media import use site and location columns consistently',()=>{
  const panel=code('app/loc/ManagementImportPanel.jsx');
  const fields=code('app/loc/import-batch.mjs');
  assert.match(panel,/location:.*null/);
  assert.match(panel,/site:String\(source/);
  assert.match(fields,/location:\['location'/);
  assert.doesNotMatch(panel,/source_place|source_name/);
  assert.doesNotMatch(fields,/source_place|source_name/);
});
test('Postgres migration includes both article and media tables',()=>{
  const sql=code('supabase/migrations/20261030023000_galaxy_location_site.sql');
  for(const name of ['lo3rwang_galaxy','lrunes_galaxy','lo3rwang_galaxy_media','lrunes_galaxy_media'])
    assert.ok(sql.includes('ALTER TABLE silver.'+name+' RENAME COLUMN'));
});
