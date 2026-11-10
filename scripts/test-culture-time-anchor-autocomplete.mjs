import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const editor=readFileSync(new URL('../app/modular/features/CultureTimelineEditor.jsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/styles/features.css',import.meta.url),'utf8');

test('time records use scoped React and native select controls',()=>{
  assert.match(editor,/import ScopeOptionPicker/);
  assert.doesNotMatch(editor,/from 'react-select'/);
  assert.match(editor,/anchorOptions=useMemo\(\(\)=>anchorChoices\.map\(row=>/);
  assert.match(editor,/options=\{anchorOptions\}/);
  assert.match(editor,/options=\{anchorOptions\.filter\(option=>option\.value!==segment\.start\)\}/);
});

test('era accepts either picking existing events or connecting anchors directly',()=>{
  assert.match(editor,/const \[tracePairs,setTracePairs\]=useState\(\[\]\)/);
  assert.match(editor,/const addPair=\(\)=>\{/);
  assert.match(editor,/const removePair=index=>setTracePairs/);
  assert.match(editor,/draft\.type==='era'&&!segments\.length&&!tracePairs\.length/);
});

test('anchor pairs reuse an existing period by anchor-id set instead of duplicating it',()=>{
  assert.match(editor,/const periodKeyOf=ids=>\[\.\.\.ids\]\.sort\(\)\.join\(','\)/);
  assert.match(editor,/const existingPeriodByPair=useMemo\(\(\)=>\{/);
  assert.match(editor,/existingPeriodByPair\.get\(periodKeyOf\(pair\)\)/);
});

test('new periods created from connected pairs use the canonical allocator and segment encoder',()=>{
  assert.ok(editor.includes("allocateTimeUid} from '../../loc/time-anchor-ranges.mjs'"));
  assert.match(editor,/const uid=allocateTimeUid\(\[\.\.\.all,\.\.\.extraPeriodRows\]\)/);
  assert.match(editor,/anchor_ids:encodeTimeSegment\(a,b\)/);
  assert.match(editor,/if\(extraPeriodRows\.length\)await insertRows\(timeTable,extraPeriodRows\)/);
});

test('era anchor_ids still mixes picked-period uids with pair-derived period uids, point-line-plane intact',()=>{
  assert.match(editor,
    /payload\.anchor_ids=draft\.type==='era'\s*\n\s*\?\[\.\.\.segments\.map\(segment=>segment\.start\),\.\.\.pairPeriodUids\]/);
});

test('invalid/stale anchors in a connected pair are rejected before save, not silently dropped',()=>{
  assert.match(editor,/if\(tracePairs\.some\(pair=>!anchors\.has\(pair\[0\]\)\|\|!anchors\.has\(pair\[1\]\)\)\)/);
  assert.match(editor,/throw new Error\('連線的定錨點有已失效的，請移除'\)/);
});

test('the display labels map era to 時代 and period to 期間',()=>{
  assert.match(editor,/era:'時代'/);
  assert.match(editor,/period:'期間'/);
  assert.doesNotMatch(editor,/時期/);
});

test('connect-anchors UI has its own styled block, not reusing the plain segment rows unstyled',()=>{
  assert.match(styles,/\.scope-culture-quick-anchor-connect\{/);
  assert.match(styles,/\.scope-culture-quick-anchor-connect-item\{/);
});

test('time editor separates era, period, and anchors before searching',()=>{
  assert.match(editor,/const TYPE_TABS=\[\.\.\.TYPES\]\.reverse\(\)/);
  assert.match(editor,/role="group" aria-label="時間紀錄類型"/);
  assert.match(editor,/rows\.filter\(row=>row\.type===browseType\)/);
  assert.match(editor,/options=\{recordOptions\}/);
  assert.match(editor,/<ScopeOptionPicker/);
  assert.doesNotMatch(editor,/<select className="scope-select" value=\{selectedId\}/);
  assert.match(editor,/setVisibilitySelection\(\[\]\)/);
  assert.match(editor,/lastExternalSelectedId\.current/);
  assert.match(editor,/切換紀錄會捨棄尚未儲存的修改/);
  assert.match(styles,/\.scope-culture-record-browser\{/);
  assert.match(styles,/\.loc-scope-option-picker>select/);
});
