import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('keyword management does not query all Pattern postings on entry',()=>{
  const source=read('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
  const load=source.slice(source.indexOf('  const load=useCallback('),
    source.indexOf('  useEffect(()=>{load();},[load]);'));
  assert.match(load,/\.in\('type',\['category','class','group','item'\]\)/);
  assert.doesNotMatch(load,/\.in\('type',\[[^\]]*'pattern'/);
  assert.match(load,/\.order\('uid',\{ascending:true\}\)/);
  assert.match(source,/\.eq\('type','pattern'\)\.in\('uid',batch\)/);
  assert.match(source,/\.abortSignal\(controller\.signal\)/);
  assert.match(source,/setPatternRead\(\{itemUid,loading:false,error:''\}\)/);
  // Authenticated query is a READ. Navigation never calls managed write.
  assert.match(source,/const references=selectedPatternRefKey/);
});

test('time editor can start its authorized read without a second public river',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/const scopeData=query\.data\?\.scope\|\|\(isTimeEditingView&&!isAggregateScope/);
  assert.match(culture,/defaultScopeData\(scopeId\)/);
  const editor=read('app/modular/features/CultureTimelineEditor.jsx');
  assert.match(editor,/queryFn:\(\)=>readCompleteTimeRecords\(timeTable\)/);
  assert.match(editor,/transactionWrites\(plan\.operations\)/);
});
