import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const librarySource=await readFile(new URL('../app/lrunes/Rune3DLibrary.jsx',import.meta.url),'utf8');
const directorySource=await readFile(new URL('../app/lrunes/rune-directory.mjs',import.meta.url),'utf8');

test('3D rune atlas renders cards from the canonical group membership function',()=>{
  assert.match(librarySource,/runeslist:\s*runeNumbersForGroup\(entry\.id\)/);
  assert.doesNotMatch(librarySource,/entry\.(start|end)/);
  assert.match(librarySource,/allRunes\.filter\(rune=>inGroup\(rune,group\)\)/);
  assert.match(librarySource,/RuneArtStage mode="runes" items=\{runes\}/);
});

test('canonical groups include all 67 catalog cards (including rune zero)',()=>{
  // Guard the canonical source, not another hard-coded mapping in the component.
  assert.match(directorySource,/if\(id===9\)return \[0,65,66\]/);
  assert.match(directorySource,/const start=\(id-1\)\*8\+1/);
  assert.match(directorySource,/Array\.from\(\{length:8\}/);
});

test('3D atlas queries only the selected group, not all 67 cards',()=>{
  assert.ok(librarySource.includes("filters:[{column:'rune_id',operator:'in',value:ids}]"));
  assert.ok(librarySource.includes('limit:ids.length,offset:0'));
  assert.ok(!librarySource.includes('limit:67,offset:0'));
  assert.ok(!librarySource.includes('next.length!==67'));
});

test('3D atlas supports the same #group-6 and rune deep-links as 2D',()=>{
  assert.ok(librarySource.includes('window.location.hash'));
  assert.ok(librarySource.includes("addEventListener('hashchange',syncLocation)"));
  assert.ok(librarySource.includes("addEventListener('popstate',syncLocation)"));
  assert.ok(librarySource.includes("'#group-'+entry.id"));
  assert.ok(librarySource.includes("'#group-'+groupId+'/rune-'+runeId"));
});

test('3D group entry shows its group introduction and cards without an automatic rune jump',()=>{
  assert.ok(librarySource.includes('setGroupId(entry.id);setFocusId(null);setShowCardInfo(false);'));
  assert.ok(!librarySource.includes('setFocusId(runeNumbersForGroup(entry.id)[0])'));
  assert.ok(!librarySource.includes('runeNumbersForGroup(id)[0]'));
  assert.ok(librarySource.includes('setFocusId(id!==null&&runeId!==null&&runeNumbersForGroup(id).includes(runeId)?runeId:null);'));
  const hero=librarySource.indexOf('rune-3d-atlas-group-hero"');
  const stage=librarySource.indexOf('rune-3d-library-manifestation"');
  const gallery=librarySource.indexOf('<RuneArtStage mode="runes" items={runes}');
  const canvas=librarySource.indexOf("ref={stageRef} className={'rune-3d-stage");
  const glyph=librarySource.indexOf('rune-3d-atlas-glyph-review');
  assert.ok(hero>=0&&hero<stage&&stage<gallery,'group introduction must precede an explicitly chosen rune effect');
  assert.ok(canvas>=0&&canvas<glyph,'actual effect canvas still precedes 3D glyph inspection');
  assert.ok(librarySource.includes('if(current&&stageRef.current)'),'only an explicitly selected card may scroll to its effect');
  assert.ok(librarySource.includes("block:'center'"),'selected rune scrolls to the effect, not section header');
});

test('board-game trend uses native Recharts responsive sizing',async()=>{
  const boardSource=await readFile(new URL('../app/lrunes/game/GameBoard.jsx',import.meta.url),'utf8');
  assert.match(boardSource,/<LineChart responsive style=\{\{width:"100%",height:"100%"\}\}/);
  assert.doesNotMatch(boardSource,/ResponsiveContainer/);
});

test('daily Rune and game charts use native Recharts responsive sizing',async()=>{
  for(const file of [
    '../app/lrunes/RuneAppDayNightDashboard.jsx',
    '../app/lrunes/DailyRuneAnalytics.jsx',
    '../app/lrunes/game/GameView.jsx'
  ]){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.match(source,/\bresponsive style=\{\{/);
    assert.doesNotMatch(source,/ResponsiveContainer/);
  }
});
