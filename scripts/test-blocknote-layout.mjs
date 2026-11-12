import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('BlockNote ObjectEditor keeps native header fields but gives long text a full row',()=>{
  const src=source('app/loc/BlockNoteEditor.jsx');
  assert.ok(parse(src,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(src,/className="scope-frame-field-grid"/);
  assert.match(src,/kind==='multiline'&&!readOnly\?' is-blocknote-field':''/);
  assert.match(src,/ariaLabel=\{UI_COPY\.common\.body\}/);
  assert.match(src,/plainTextOnly canInsertImage=\{false\}/);
  assert.match(src,/if\(mode==='scope'\)/);
  assert.match(src,/if\(mode==='fields'\)/);
});

test('BlockNote sizing uses a shrinkable content column and preserves native popup layout',()=>{
  const css=source('app/styles/features.css');
  assert.match(css,/\.scope-blocknote \.bn-editor\{[^}]*box-sizing:border-box;[^}]*width:100%;[^}]*max-width:100%/s);
  assert.match(css,/\.scope-blocknote,\s*\.scope-blocknote \.bn-container\{[^}]*width:100%/s);
  assert.match(css,/\.scope-page-editor \.scope-frame-field-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,27rem\),1fr\)\)/s);
  assert.match(css,/\.scope-page-editor \.scope-frame-field-grid>\.scope-management-wide-field:not\(\.scope-frame-header-field\)\{[^}]*grid-column:1\/-1/s);
  assert.match(css,/\.scope-search-attr-grid>\.scope-search-attr-item\.is-blocknote-field\{[^}]*grid-column:1\/-1/s);
  assert.match(css,/\.scope-blocknote-linkbar>\.loc-button\{min-height:44px\}/);
  assert.match(css,/\.scope-frame-image-fields\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,21rem\),1fr\)\)/s);
  assert.match(css,/\.scope-frame-image-fields \.scope-frame-image-url\{[^}]*grid-column:1\/-1/s);
  assert.doesNotMatch(css,/\.scope-blocknote \.bn-editor\{[^}]*overflow:hidden/s);
  assert.doesNotMatch(css,/\.scope-blocknote \.bn-container\{[^}]*overflow:hidden/s);
});

test('inline editing actions stay in flow above BlockNote and mobile collapses to one column',()=>{
  const css=source('app/styles/features.css');
  assert.match(css,/\.scope-editable-block:is\(\.is-editing,\.scope-block-draft\) \.scope-inline-editbar\{[^}]*position:relative/s);
  assert.match(css,/\.scope-editable-block:is\(\.is-editing,\.scope-block-draft\)\{padding-top:\.85rem\}/);
  assert.match(css,/@media\(max-width:680px\)\{[\s\S]*?\.scope-page-editor \.scope-frame-field-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  const draft=source('app/loc/ScopeBlockDraftList.jsx');
  const session=source('app/loc/ScopeBlockEditorSession.jsx');
  assert.match(draft,/<ObjectEditor mode="scope" fields=\{\[/);
  assert.match(session,/<ObjectEditor mode="scope" fields=\{\[/);
});

test('management rich text and spatial descriptions align without touching BlockNote persistence',()=>{
  const css=source('app/styles/settings-select.css');
  assert.match(css,/\.management-workspace-panel \.scope-management-fields>\.loc-trace-description-field/);
  assert.match(css,/grid-column:1\/-1/);
  assert.match(css,/\.management-hero-copy-editor>\.scope-management-wide-field\{/);
  const hero=source('app/loc/views/admin-panels/FeatureHeroImages.jsx');
  const spatial=source('app/loc/TraceManagement.jsx');
  assert.match(hero,/<BlockNoteEditor editorKey=\{'management-hero:'/);
  assert.match(spatial,/<div className="loc-trace-description-field">/);
  assert.match(spatial,/onPlainTextChange=\{setDescription\}/);
});

test('management edit panels reflow from their own width without truncating rich fields',()=>{
  const css=source('app/styles/settings-select.css');
  assert.match(css,/\.management-workspace-panel \.scope-management-fields,\s*\.management-workspace-panel \.admin-page-copy-fields\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,27rem\),1fr\)\)/s);
  assert.match(css,/\.management-workspace-panel \.scope-management-fields>\.scope-management-wide-field\{grid-column:1\/-1/);
  assert.match(css,/@container \(max-width: 62rem\)/);
});

test('shared DIV layout has one canonical CSS owner instead of stacked overrides',()=>{
  const css=source('app/styles/features.css');
  const frame=source('app/styles/uiux.css');
  const scope=source('app/modular/ui.jsx');
  // One base declaration plus one phone-specific exception.
  assert.equal((css.match(/\.scope-page-editor \.scope-frame-field-grid\{/g)||[]).length,2);
  assert.equal((css.match(/\.scope-frame-image-fields\{/g)||[]).length,2);
  assert.equal((css.match(/^\.scope-blocknote \.bn-editor\{/gm)||[]).length,1);
  assert.equal((css.match(/^\.scope-editor-blocknote\{/gm)||[]).length,1);
  assert.doesNotMatch(css,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.1fr\) minmax\(0,1\.6fr\)/);
  assert.doesNotMatch(css,/\.scope-frame-image-url\{grid-column:span 2/);
  assert.match(frame,/\.loc-next-main,\.scope-main,\.loc-view,\.scope-page,\.scope-content\{\s*min-width:0;\s*max-width:100%;/);
  assert.doesNotMatch(frame,/\.scope-main--edit-workspace \.scope-content>\*/);
  assert.match(scope,/return <main className=\{'scope-main'/);
  assert.match(scope,/<section className="scope-page">/);
  assert.match(scope,/className=\{"scope-content"/);
});

test('shared management field layout is owned once and shrinks inside the page grid',()=>{
  const features=source('app/styles/features.css');
  const components=source('app/styles/components.css');
  const ui=source('app/styles/uiux.css');
  const shell=source('app/modular/ui.jsx');
  assert.equal((features.match(/^\.scope-management-fields\{/gm)||[]).length,1);
  assert.match(features,/\.scope-management-fields\{\s*display:grid;\s*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,15rem\),1fr\)\);/);
  assert.doesNotMatch(components,/\.loc-view\{display:grid;gap:/);
  assert.match(ui,/\.loc-view,\.scope-page,\.scope-content\{\s*gap:clamp/);
  assert.match(ui,/\.loc-next-main,\.scope-main,\.loc-view,\.scope-page,\.scope-content\{\s*min-width:0;\s*max-width:100%;/);
  assert.match(shell,/<section className="scope-page">/);
  assert.match(shell,/className=\{"scope-content"/);
  assert.doesNotMatch(ui,/\.scope-main--edit-workspace \.scope-content>\*/);
});
