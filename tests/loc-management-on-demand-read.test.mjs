import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('keyword management reads only authored Item words; no Pattern posting read',()=>{
  const source=read('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
  const load=source.slice(source.indexOf('  const load=useCallback('),
    source.indexOf('  useEffect(()=>{load();},[load]);'));
  assert.match(load,/\.in\('type',\['category','class','group','item'\]\)/);
  assert.doesNotMatch(load,/\.in\('type',\[[^\]]*'pattern'/);
  assert.match(load,/\.order\('uid',\{ascending:true\}\)/);
  assert.doesNotMatch(source,/\.eq\('type','pattern'\)/);
  assert.doesNotMatch(source,/setPatternRead|selectedPatternRefKey|pattern_index_version/);
  // Item words come directly from attr.keyword, not a second query.
  assert.match(source,/row\.attr\?\.\[row\.type==='item'\?'keyword':'uid'\]/);
});

test('time editor can start its authorized read without a second public river',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/const scopeData=query\.data\?\.scope\|\|\(isTimeEditingView&&!isAggregateScope/);
  assert.match(culture,/defaultScopeData\(scopeId\)/);
  const editor=read('app/modular/features/CultureTimelineEditor.jsx');
  const query=read('app/loc/culture/query.js');
  assert.match(culture,/selectScopeCultureManagementData\(scopeId,\{signal\}\)/);
  assert.match(culture,/timeRecords=\{query\.data\?\.editorRows\|\|null\}/);
  assert.match(query,/const editorRows=await readManagedTimeRecords\(scope\.time,\{signal\}\)/);
  assert.match(query,/const parts=cultureParts\(editorRows,scope\.id\)/);
  assert.match(editor,/const all=Array\.isArray\(timeRecords\)\?timeRecords:\[\]/);
  assert.doesNotMatch(editor,/selectRows\(|readCompleteTimeRecords|useAsyncResource/);
  assert.match(editor,/transactionWrites\(plan\.operations\)/);
});
