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
