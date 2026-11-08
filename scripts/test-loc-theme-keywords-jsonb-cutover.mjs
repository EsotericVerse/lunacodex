import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('public Theme reads published JSON; authorized editor alone uses LOC JSONB',()=>{
  const theme=file('app/loc/theme-data.js');
  const editor=file('app/loc/views/admin-panels/ThemeEditor.jsx');
  const publisher=file('scripts/generate-public-blocks.mjs');
  const bootstrap=file('app/loc/app-bootstrap.js');
  assert.match(theme,/published-theme-catalog\.json/);
  assert.doesNotMatch(theme,/selectRows\('silver\.loc'/);
  assert.doesNotMatch(theme,/silver\.loc_theme/);
  assert.match(editor,/dbAuthRelation\('silver\.loc'\)\.select\('theme'\)/);
  assert.match(editor,/p_section:'theme',p_operation:'upsert'/);
  assert.doesNotMatch(editor,/invalidateAppBootstrapThemes|mutate\(key=>Array\.isArray\(key\).*app-bootstrap/);
  assert.match(bootstrap,/themes:publishedThemes/);
  assert.match(publisher,/db\.from\('loc'\)/);
  assert.match(publisher,/\.select\('theme'\)/);
  assert.match(publisher,/published-theme-catalog\.json/);
  assert.doesNotMatch(publisher,/db\.from\('loc_theme'\)/);
});
test('LOC Keyword registry reads and writes through authorized JSONB RPC',()=>{
  const ui=file('app/loc/LocKeywordManagement.jsx');
  const gateway=file('app/loc/providers/kysely-runtime.mjs');
  assert.doesNotMatch(ui,/silver\.loc_keywords/);
  for(const operation of ['read','upsert','delete'])
    assert.match(ui,new RegExp("p_section:'keywords',p_operation:'"+operation+"'"));
  assert.match(gateway,/'silver\.loc_admin_settings':\['p_section','p_operation','p_key','p_value'\]/);
  assert.doesNotMatch(gateway,/'silver\.loc_catalog':/);
  assert.match(ui,/rpc\('loc_admin_settings'/);
  const retired=file('supabase/migrations/20261103173000_merge_catalog_into_existing_rpcs.sql');
  assert.match(retired,/DROP FUNCTION silver\.loc_catalog\(text,text,text,jsonb\) RESTRICT/);
  assert.match(retired,/DROP FUNCTION silver\.read_keyword_tree_catalog\(text,text\) RESTRICT/);
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
