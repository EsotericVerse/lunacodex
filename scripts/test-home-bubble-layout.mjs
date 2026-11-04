import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  defaultHomeBubbleColumns,homeBubbleColumns,homeBubbleEntities,
  serializeHomeBubbleEntities,normalizeHomeBlockEntities
} from '../app/loc/home-block-model.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const bubble={uid:'ABC12345',title:'',text:'文字泡泡'};

test('per-page defaults and explicit 2/3/6 columns',()=>{
  assert.equal(defaultHomeBubbleColumns('index'),3);
  assert.equal(defaultHomeBubbleColumns('trace'),2);
  assert.equal(defaultHomeBubbleColumns('search'),6);
  for(const number of [2,3,6]){
    assert.equal(homeBubbleColumns([number,bubble],'index'),number);
    assert.deepEqual(homeBubbleEntities([number,bubble]),[bubble]);
    assert.equal(serializeHomeBubbleEntities(number,[bubble])[0],number);
  }
  assert.equal(homeBubbleColumns([bubble],'search'),6);
  assert.equal(homeBubbleColumns([4,bubble],'index'),3);
});

test('legacy and new JSONB arrays preserve children in their original order',()=>{
  const another={uid:'XYZ98765',title:'標題',text:'第二筆'};
  for(const value of [[bubble,another],[6,bubble,another]]){
    assert.deepEqual(normalizeHomeBlockEntities(value).map(item=>item.uid),[bubble.uid,another.uid]);
  }
  const stored=serializeHomeBubbleEntities(3,[bubble,another]);
  assert.deepEqual(stored,[3,bubble,another]);
});

test('home, inline edit, and public displays retain the same bubble layout contract',()=>{
  for(const path of ['app/loc/ScopeBlockDraftList.jsx','app/loc/ScopeBlockEditorSession.jsx']){
    const source=read(path);
    assert.match(source,/文字泡泡排列（每列）/);
    assert.match(source,/serializeBubbleEntities\(draft\.bubbleColumns/);
  }
  assert.match(read('app/loc/ScopeEditableBlocks.jsx'),/bubbleColumns:HomeBlock\.bubbleColumns/);
  assert.match(read('app/loc/LocHomeBlockDisplay.jsx'),/--loc-bubble-columns/);
  assert.match(read('app/styles/loc-about-original.css'),/--loc-bubble-columns/);
});
