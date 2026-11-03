import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/loc/ScopeSourceCorrection.jsx',import.meta.url),'utf8');
const manager=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');

test('opening import management does not mount source correction queries',()=>{
  assert.match(manager,/<ScopeSourceCorrection scopeId=\{scopeId\}\/>/);
  assert.match(source,/function ScopeSourceCorrectionEditor\(\{scopeId\}\)/);
  assert.match(source,/export default function ScopeSourceCorrection\(\{scopeId\}\)/);
  const wrapper=source.slice(source.indexOf('export default function ScopeSourceCorrection('));
  assert.match(wrapper,/useState\(false\)/);
  assert.match(wrapper,/aria-expanded=\{expanded\}/);
  assert.match(wrapper,/expanded\?<ScopeSourceCorrectionEditor scopeId=\{scopeId\}\/>:null/);
  assert.doesNotMatch(wrapper,/readScopeCategoryTotals|useScopeSourceCategoryRow|useEditDockForm/);
});

test('source suggestions only fetch after opting into the editor, and failure is retryable',()=>{
  const editor=source.slice(source.indexOf('function ScopeSourceCorrectionEditor('),
    source.indexOf('export default function ScopeSourceCorrection('));
  assert.match(editor,/useScopeSourceCategoryRow\('loc',\{enabled:allowed\}\)/);
  assert.match(editor,/useScopeSourceCategoryRow\(scopeId,\{enabled:allowed\}\)/);
  assert.match(editor,/readScopeCategoryTotals\(scopeId\)/);
  assert.match(editor,/sourceLists\.refetch\(\)/);
  assert.match(editor,/可自行輸入來源名稱/);
  assert.match(editor,/useEditDockForm\(/);
});


test('Clerk batch writes use provider-neutral signed subject and keep Scope authorization',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261103174500_portable_clerk_batch_auth.sql',import.meta.url),'utf8');
  for(const name of ['batch_fill_galaxy_location','preview_or_fill_galaxy_place','rename_scope_site_batch']){
    assert.match(sql,new RegExp('CREATE OR REPLACE FUNCTION silver\\.'+name+'\\('));
  }
  assert.equal((sql.match(/api\.current_user_id\(\) IS NULL/g)||[]).length,3);
  assert.doesNotMatch(sql,/auth\.uid\(\)/);
  assert.match(sql,/DROP FUNCTION silver\.loc_public_routing_state\(\) RESTRICT/);
  assert.match(sql,/silver\.manage\('scope',p_scope_id\)/);
});
