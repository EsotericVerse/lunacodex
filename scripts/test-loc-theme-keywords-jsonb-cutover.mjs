import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('public Theme uses LOC JSONB and Admin editor updates a single slot via authorized RPC',()=>{
  const theme=file('app/loc/theme-data.js');
  const editor=file('app/loc/views/admin-panels/ThemeEditor.jsx');
  const publisher=file('scripts/generate-public-blocks.mjs');
  assert.match(theme,/selectRows\('silver\.loc'/);
  assert.match(theme,/columns:'theme'/);
  assert.doesNotMatch(theme,/silver\.loc_theme/);
  assert.match(editor,/dbAuthRelation\('silver\.loc'\)\.select\('theme'\)/);
  assert.match(editor,/p_section:'theme',p_operation:'upsert'/);
  assert.match(publisher,/db\.from\('loc'\)/);
  assert.match(publisher,/\.select\('theme'\)/);
  assert.doesNotMatch(publisher,/db\.from\('loc_theme'\)/);
});
test('LOC Keyword registry reads and writes through authorized JSONB RPC',()=>{
  const ui=file('app/loc/LocKeywordManagement.jsx');
  const gateway=file('app/loc/providers/kysely-runtime.mjs');
  assert.doesNotMatch(ui,/silver\.loc_keywords/);
  for(const operation of ['read','upsert','delete'])
    assert.match(ui,new RegExp("p_section:'keywords',p_operation:'"+operation+"'"));
  assert.match(gateway,/'silver\.loc_catalog':\['p_section','p_action','p_key','p_value'\]/);
});
test('database migrations preserve every row then drop retired relations with RESTRICT',()=>{
  const stage=file('supabase/migrations/20261103040000_loc_theme_keywords_jsonb_cutover.sql');
  const drop=file('supabase/migrations/20261103043000_drop_loc_theme_keywords_after_catalog_cutover.sql');
  assert.match(stage,/ADD COLUMN IF NOT EXISTS theme jsonb/);
  assert.match(stage,/ADD COLUMN IF NOT EXISTS keywords jsonb/);
  assert.match(stage,/jsonb_agg\(to_jsonb\(t\) ORDER BY t\.theme_order\)/);
  assert.match(stage,/jsonb_agg\(to_jsonb\(k\) ORDER BY k\.scope_id,k\.class_name\)/);
  assert.match(stage,/CREATE OR REPLACE FUNCTION silver\.loc_catalog/);
  assert.match(stage,/CREATE OR REPLACE FUNCTION silver\.read_app_bootstrap/);
  assert.doesNotMatch(stage,/v_theme_rows silver\.loc_theme\[\]/);
  assert.match(drop,/DROP TABLE silver\.loc_theme RESTRICT/);
  assert.match(drop,/DROP TABLE silver\.loc_keywords RESTRICT/);
  assert.doesNotMatch(drop,/CASCADE/);
});
test('retired Theme relation is not exposed through external SQL authority',()=>{
  const edge=file('supabase/functions/loc-kysely/index.ts');
  const sql=file('app/loc/providers/sql-engine-ports.mjs');
  const policy=file('workers/loc-authority/sql-authorization.mjs');
  assert.doesNotMatch(edge,/adaptNeonThemeRequest/);
  assert.doesNotMatch(sql,/'loc_theme'/);
  assert.doesNotMatch(policy,/'loc_theme'/);
});
