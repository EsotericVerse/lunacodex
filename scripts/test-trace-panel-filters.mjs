import test from 'node:test';
import assert from 'node:assert/strict';
import {
  traceWindow,traceArticleFilters,traceArticleIdFilters,groupedTraceDays,traceMediaMatches,
  TRACE_MEDIA_TYPES
} from '../app/modular/features/trace/trace-panel-filters.mjs';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('default recent three months respects Taiwan civil day and calendar month boundary',()=>{
  assert.deepEqual(traceWindow('3m',new Date('2026-10-26T12:00:00Z')),
    {startDate:'2026-07-26',endDate:'2026-10-26'});
  assert.deepEqual(traceWindow('all'),{startDate:'',endDate:''});
  assert.deepEqual(traceWindow('3m',new Date('2026-05-31T08:00:00Z')),
    {startDate:'2026-02-28',endDate:'2026-05-31'});
});

test('Threads is an exact case-insensitive source filter, not a media subtype',()=>{
  const filters=traceArticleFilters(['板橋車站'],{
    startDate:'2026-07-26',endDate:'2026-10-26',sourceName:'Threads'
  });
  assert.ok(filters.some(f=>f.column==='location'&&f.operator==='eq'&&f.value==='板橋車站'));
  assert.ok(filters.some(f=>f.column==='site'&&f.operator==='ilike'&&f.value==='Threads'));
  assert.ok(filters.some(f=>f.column==='date'&&f.operator==='gte'&&f.value==='2026-07-26'));
  assert.ok(filters.some(f=>f.column==='date'&&f.operator==='lte'&&f.value==='2026-10-26'));
  assert.ok(!filters.some(f=>f.column==='type'));
});

test('media choices follow article media_link without reverse dependencies',()=>{
  assert.deepEqual([...TRACE_MEDIA_TYPES],['音樂','圖片','影片','rune']);
  const articles=[{uid:'AAAAAAAA',title:'Threads image',media_link:['MEDIA001','MEDIA002']},
    {uid:'BBBBBBBB',title:'unrelated',media_link:[]}];
  assert.deepEqual(traceMediaMatches(articles,[{uid:'MEDIA001',type:'圖片'}]),
    [articles[0]]);
});

test('count groups only from selected metadata; never invent dates',()=>{
  const rows=[
    {location:'板橋車站',createtime:'2026-10-01T12:00:00+08:00'},
    {location:'板橋車站',createtime:'2026-10-01T16:00:00+08:00'},
    {location:'',createtime:'2026-10-01T16:00:00+08:00'},
    {location:'板橋車站',createtime:null}
  ];
  assert.deepEqual(groupedTraceDays(rows),[
    {day:'2026-10-01',category:'板橋車站',item_count:2}
  ]);
});

test('article date filters use indexed date; no timestamp conversion in lists',()=>{
  const filters=traceArticleIdFilters(['0001'],{
    startDate:'2026-01-01',endDate:'2026-10-31'
  });
  assert.ok(filters.some(f=>f.column==='date'&&f.operator==='gte'&&f.value==='2026-01-01'));
  assert.ok(filters.some(f=>f.column==='date'&&f.operator==='lte'&&f.value==='2026-10-31'));
  assert.ok(!filters.some(f=>f.column==='createtime'));
  assert.deepEqual(groupedTraceDays([{place_id:'0001',date:'2026-10-31',
    createtime:'2026-10-30T16:00:00Z'}],{key:'place_id'}),
    [{day:'2026-10-31',category:'0001',item_count:1}]);
});

test('Trace panel only projects three Galaxy list columns; media type filters use bounded UID overlap',()=>{
  const trace=read('app/modular/features/Trace.jsx');
  const result=read('app/modular/features/trace/TracePlaceResults.jsx');
  assert.match(trace,/queryFn:\(\)=>readTraceMapIndex\(scopeId\)/);
  assert.match(trace,/enabled:supported&&routeListOpen/);
  assert.match(trace,/\[reportTab,setReportTab\]=useState\(null\)/);
  assert.match(trace,/\[timeWindow,setTimeWindow\]=useState\('all'\)/);
  assert.match(trace,/readCurrentTraceAnchors\(periodScopeId,members,/);
  assert.match(trace,/\{reportTab\?<TracePlaceResults/);
  assert.match(trace,/sourceName=\{sourceName\} mediaType=\{mediaType\}/);
  assert.match(result,/mediaFiltered=useAsyncInfiniteResource/);
  assert.match(result,/columns:'uid,title,createtime'/);
  assert.match(result,/columns:'uid'/);
  assert.match(result,/operator:'overlaps'/);
  assert.match(result,/limit:PAGE_SIZE,maxLimit:PAGE_SIZE,offset:articleOffset/);
  assert.match(result,/enabled:enabled&&Boolean\(selectedMediaType\)/);
  assert.doesNotMatch(result,/selectAllRows\(/);
  assert.doesNotMatch(result,/columns:'uid,title,createtime,[^']*media_link/);
  assert.match(trace,/<option value="rune">抽牌結果（runes）<\/option>/);
});


test('selected article integrates synchronous date statistics without a promise crash',()=>{
  const query=read('app/loc/galaxy-query.js');
  assert.match(query,/function articleStatisticsContext\(scope,day\)/);
  assert.match(query,/articleStatisticsContext\(current,day\)/);
  assert.doesNotMatch(query,/articleStatisticsContext\(current,day\)\.catch\(/);
  assert.match(query,/related_space:space,related_time:time,related_statistics:statistics/);
});


test('Culture and Statistics article lists never fetch Galaxy Media without a media selection',()=>{
  const culture=read('app/loc/culture-query.js');
  const stat=read('app/modular/features/Statistics.jsx');
  assert.match(culture,/const includeMedia=rawMedia\.length>0;/);
  assert.match(culture,/columns:'uid,title,createtime'/);
  assert.match(stat,/全部文章列表/);
  assert.doesNotMatch(stat,/全部作品列表（含多媒體）/);
});


test('article detail separates original links, linked media, rune data and structural sections',()=>{
  const reader=read('app/modular/ui.jsx');
  assert.match(reader,/<div key=\{item\.uid\|\|index\} className="scope-article-context-media">/);
  assert.doesNotMatch(reader,/<span key=\{item\.uid\|\|index\} className="scope-article-context-media">/);
  assert.match(reader,/row\('相關媒體外部連結',ordinaryMedia\)/);
  assert.match(reader,/row\('相關媒體資料',mediaDetails\)/);
  assert.match(reader,/row\('抽牌結果（多媒體）',runeMedia\)/);
  assert.match(reader,/row\('文章原始網址'/);
  for(const group of ['時間','空間','統計'])
    assert.ok(reader.includes('<h3>'+group+'</h3>'));
  assert.match(reader,/row\('關鍵詞組別'/);
});


test('Galaxy date grouping uses canonical date columns',()=>{
  const query=read('app/loc/galaxy-query.js');
  assert.doesNotMatch(query,/String\(table\|\|''\)==='silver\.local_galaxy'/);
  assert.match(query,/dateColumn:dayColumn\(current\.galaxy\)/);
});


test('editing an expanded UID fetches all attributes instead of reusing a thin reader row',()=>{
  const search=read('app/modular/features/Search.jsx');
  assert.match(search,/const fullRow=await selectPublicEditableRow\(/);
  assert.doesNotMatch(search,/const cached=result\.resourceType==='galaxy'/);
  assert.match(search,/GALAXY_EDITOR_COLUMNS='uid,title,content,createtime,location,place_id,searchable,UpdateTime/);
  assert.match(search,/media_link,statistics_able'/);
});
test('explicit Culture/Statistics media lanes keep their external media links',()=>{
  for(const path of ['app/modular/features/Culture.jsx','app/modular/features/Statistics.jsx']){
    const content=read(path);
    assert.match(content,/links=\{work\.entry_type==='media_metadata'\?work\.links\|\|\[\]:/);
  }
});


test('category counting uses a DB-side aggregate without full-row streaming',()=>{
  const galaxy=read('app/loc/galaxy-query.js');
  assert.match(galaxy,/async function selectCategoryCountsRaw\(/);
  assert.match(galaxy,/readScopeCategoryTotals\(match\[1\]/);
  assert.doesNotMatch(galaxy,/countStreamed\(/);
});
