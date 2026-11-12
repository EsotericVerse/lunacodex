import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blockNoteSuggestionItems} from '../app/loc/blocknote-suggestions.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('spatial completion accepts only point, path and trace',()=>{
  const rows=[
    {uid:'Aa12Bb34',type:'point',title:'板橋'},
    {uid:'Ab12Bb34',trace_type:'space_anchor',title:'台北'},
    {uid:'Cc12Dd34',type:'path',title:'海線'},
    {uid:'Dd12Ee34',type:'trace',title:'散步'},
    {uid:'Ee12Ff34',type:'pattern',title:'不可顯示'}
  ];
  assert.deepEqual(blockNoteSuggestionItems('spatial',rows).map(x=>x.type),
    ['point','point','path','trace']);
  assert.deepEqual(blockNoteSuggestionItems('spatial',rows,'海').map(x=>x.uid),['Cc12Dd34']);
});

test('time completion includes dates, periods, eras and virtual aniversary',()=>{
  const rows=[
    {uid:'Aa12Bb34',type:'anchor',title:'生日'},
    {uid:'Ab12Bb34',type:'date',title:'紀念日'},
    {uid:'Cc12Dd34',type:'period',title:'期間'},
    {uid:'Dd12Ee34',type:'era',title:'時代'},
    {type:'aniversary',title:'週年'},
    {type:'point',title:'不是時間'}
  ];
  assert.deepEqual(blockNoteSuggestionItems('time',rows).map(x=>x.type),
    ['date','date','period','era','aniversary']);
});

test('search completion accepts pattern only and rejects bad candidates',()=>{
  assert.deepEqual(blockNoteSuggestionItems('pattern',
    ['月光','月語',{type:'point',title:'地點'}],'月').map(x=>x.title),['月光','月語']);
  assert.deepEqual(blockNoteSuggestionItems('pattern',[{type:'pattern',title:'   '}]),[]);
  assert.deepEqual(blockNoteSuggestionItems('pattern',[{type:'pattern',title:'合法',uid:'bad'}]),[]);
  assert.deepEqual(blockNoteSuggestionItems('pattern',['月光'],'x'.repeat(121)),[]);
  assert.deepEqual(blockNoteSuggestionItems('spatial',['月光']),[]);
});

test('management Hero uses shared BlockNote rich editor, no textarea',()=>{
  const hero=read('app/loc/views/admin-panels/FeatureHeroImages.jsx');
  const management=hero.split('function ManagementHeroDetails(')[1]
    ?.split('export default function FeatureHeroImages(')[0]||'';
  assert.match(management,/className="management-hero-copy-grid"/);
  assert.match(management,/className="management-hero-copy-row"/);
  assert.match(management,/<BlockNoteEditor editorKey=/);
  assert.match(management,/onHtmlChange=\{html=>setDraft/);
  assert.doesNotMatch(management,/<textarea/);
  assert.match(read('app/modular/ui.jsx'),/rich=\{Boolean\(shared\)/);
});

test('keyword and source descriptions reuse shared BlockNote with text persistence',()=>{
  for(const file of ['app/loc/KeywordLibraryPanel.jsx','app/loc/SourceCategoryEditor.jsx']){
    const source=read(file);
    assert.match(source,/<BlockNoteEditor editorKey=/);
    assert.match(source,/plainTextOnly canInsertImage=\{false\}/);
    assert.match(source,/onPlainTextChange=\{value=>/);
  }
  const keyword=read('app/loc/KeywordLibraryPanel.jsx');
  assert.match(keyword,/<textarea rows=\{9\} value=\{keywordText\}/);
  const source=read('app/loc/SourceCategoryEditor.jsx');
  assert.doesNotMatch(source,/<textarea/);
});

test('freeform multiline attributes use BlockNote while structural arrays stay typed',()=>{
  const code=read('app/loc/BlockNoteEditor.jsx');
  assert.match(code,/kind==='multiline'\?<BlockNoteEditor/);
  assert.match(code,/kind==='array'\?<textarea/);
  assert.match(code,/const Wrapper=kind==='multiline'/);
  const css=read('app/styles/features.css');
  assert.match(css,/\.scope-blocknote\.is-plain-text \.bn-editor/);
});

test('BlockNote native link controls replace handwritten link buttons',()=>{
  const editor=read('app/loc/BlockNoteEditorClient.jsx');
  assert.doesNotMatch(editor,/function editLink\(|function removeLink\(/);
  assert.match(editor,/<BlockNoteView/);
  assert.match(editor,/onClick=\{insertImageUrl\}/);
});

test('native BlockNote menu integrates Zod types in anchor text only',()=>{
  const client=read('app/loc/BlockNoteEditorClient.jsx');
  assert.match(client,/SuggestionMenuController/);
  assert.match(client,/blockNoteSuggestionItems\(suggestionKind,suggestions,query\)/);
  for(const file of [
    'app/loc/TraceManagement.jsx',
    'app/loc/TraceRouteManager.jsx',
    'app/modular/features/CultureTimelineEditor.jsx',
    'app/modular/ArticleTimeAnchorAction.jsx'
  ])assert.match(read(file),/suggestionKind="(?:spatial|time)"/,file);
  assert.match(read('app/modular/features/Search.jsx'),/blockNoteSuggestionItems\('pattern'/);
  assert.doesNotMatch(read('app/modular/modules/statistics/StatisticsMultiChart.jsx'),/suggestionKind=/);
});
