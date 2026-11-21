import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const home=read('../app/loc/views/AboutView.jsx');
const switcher=read('../app/loc/blocks/ScopeEditableBlocks.jsx');
const draft=read('../app/loc/blocks/ScopeBlockDraftList.jsx');
const frame=read('../app/loc/blocks/LocHomeBlockDisplay.jsx');
const css=read('../app/styles/home-composition.css');

test('homepage view and editor use the exact same frame contract',()=>{
  assert.match(home,/renderDisplay=\{LocHomeBlockDisplay\}/);
  assert.match(home,/resolveSlotClassName=\{locHomeBlockClass\}/);
  assert.match(home,/resolveSlotStyle=\{homeBlockMediaStyle\}/);
  for(const prop of ['renderDisplay','resolveSlotClassName','resolveSlotStyle'])
    assert.match(switcher,new RegExp(prop+'=\\{'+prop+'\\}'));
  assert.match(draft,/const homePreview=pageName==='index'/);
  assert.match(draft,/className=\{resolveSlotClassName\(draft\)\+' scope-editable-block scope-home-edit-preview'\}/);
  assert.match(draft,/style=\{typeof resolveSlotStyle==='function'\?resolveSlotStyle\(draft\):undefined\}/);
  assert.match(draft,/\{renderDisplay\(draft\)\}/);
  assert.match(frame,/function SharedHomeBlockDisplay\(slot,scopeId='loc'\)/);
});

test('editing is a separate form, never a replacement frame or image fallback',()=>{
  assert.match(draft,/\{expanded\?<div className="scope-home-edit-fields">\{content\}<\/div>:null\}/);
  assert.match(draft,/return <Fragment key=\{draft.uid\}>/);
  assert.match(draft,/data-page-name=\{pageName\} data-block-order=\{draft.order\}/);
  assert.match(css,/\.loc-home>\.scope-home-edit-preview>\.scope-inline-editbar\s*\{[\s\S]*?position:absolute/);
  assert.match(css,/\.loc-home>\.scope-home-edit-fields\s*\{[\s\S]*?display:grid/);
  assert.doesNotMatch(draft,/scope-home-edit-preview scope-block-draft/);
});
