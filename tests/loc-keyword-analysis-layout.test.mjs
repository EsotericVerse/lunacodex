import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const panel=file('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
const css=file('app/styles/features.css');

test('keyword analysis stays inside the Scope management panel',()=>{
  assert.match(panel,/className="scope-keyword-management loc-keyword-management-layout"/);
  assert.match(panel,/id="scope-keyword-workspace" className="loc-keyword-workspace-panel"/);
  assert.match(css,/\.loc-keyword-management-layout\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.loc-keyword-workspace-panel\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
});

test('class select and both analysis actions have a stable non-overflowing layout',()=>{
  const segment=panel.slice(panel.indexOf('<h2>關鍵詞解析</h2>'),
    panel.indexOf('<summary>上次解析與文章統計</summary>'));
  assert.match(segment,/className="loc-keyword-analysis-toolbar"/);
  assert.match(segment,/className="scope-preview-links loc-keyword-analysis-actions"/);
  assert.match(segment,/重新分析/);
  assert.match(segment,/清空分析/);
  assert.doesNotMatch(segment,/\b0<div className="scope-preview-links/);
  assert.match(css,/\.loc-keyword-analysis-toolbar\s*\{[^}]*display:grid/);
  assert.match(css,/\.loc-keyword-analysis-toolbar>label>\.scope-select\s*\{[^}]*max-width:100%/);
  assert.match(css,/\.loc-keyword-analysis-toolbar>\.loc-keyword-analysis-actions\s*\{[^}]*flex-wrap:wrap/);
});
