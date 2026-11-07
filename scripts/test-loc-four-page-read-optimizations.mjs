import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapBounded} from '../app/loc/bounded-parallel.mjs';
import {searchOrderedScopeProviders} from '../app/loc/search-ordered-scope-providers.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const analytics=read('app/loc/providers/kysely-analytics.mjs');
const extract=(start,end)=>{
  const a=analytics.indexOf(start),b=analytics.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Missing analytics function '+start);
  return analytics.slice(a,b);
};

test('Culture Time River uses Galaxy.date for filtering and grouped density, not upload time',async()=>{
  const source=extract('async function simpleCultureData(', '// One exact bounded Culture article page.');
  assert.match(source,/\.where\('date','>=',start\)/);
  assert.match(source,/\.where\('date','<=',end\)/);
  assert.doesNotMatch(source,/\.where\('createtime'/);

  const queries=[];
  const row={date:'2026-05-12',site:'threads',item_count:4};
  const builder={
    select(){return this;},
    where(...args){queries.push(['where',...args]);return this;},
    groupBy(...args){queries.push(['groupBy',...args]);return this;},
    orderBy(...args){queries.push(['orderBy',...args]);return this;},
    async execute(){return [row]}
  };
  const stub={selectFrom(name){queries.push(['table',name]);return builder}};
  const create=new Function('portableRelation','portableDay','reject',
    source+';return simpleCultureData;');
  const run=create(name=>name,value=>String(value).slice(0,10),message=>{throw Error(message)});
  const result=await run(stub,'lo3rwang','culture_density','2026-05-01','2026-05-31',
    {engine:'postgres',namespace:'silver'});
  assert.deepEqual(result,[{day:'2026-05-12',site:'threads',item_count:4}]);
  assert.ok(queries.some(([kind,key,op,value])=>kind==='where'&&key==='date'&&op==='>='&&value==='2026-05-01'));
  assert.ok(queries.some(([kind,key,op,value])=>kind==='where'&&key==='date'&&op==='<='&&value==='2026-05-31'));
  assert.ok(!queries.some(([kind,key])=>key==='createtime'));
});

test('Postgres Statistics daily source and total counts use one grouped aggregation, not a media Join',async()=>{
  const source=extract('async function dailyStats(', 'async function earliest(');
  assert.match(source,/group by grouping sets \(\(s\.d,s\.c\),\(s\.d\)\)/i);
  assert.match(source,/grouping\(s\.c\)=1/);
  assert.doesNotMatch(source,/\bunion\s+all\b|\bjoin\b|media_link|mediaCount/i);
  let requests=0,compiled='';
  const sql=(strings,...params)=>({
    async execute(){
      requests++;
      compiled=strings.join('?');
      assert.equal(params.length,6); // relation, undated flag, and two inclusive date bounds
      return {rows:[
        {day:'2026-05-12',kind:'source',category:'threads',item_count:4},
        {day:'2026-05-12',kind:'total',category:'文字作品',item_count:4}
      ]};
    }
  });
  sql.ref=name=>name;
  const fn=new Function('sql','relation',source+';return dailyStats;')(
    sql,(scope,suffix)=>sql.ref('silver.'+scope+'_'+suffix));
  const rows=await fn({},'lo3rwang','2026-05-01','2026-05-31',false);
  assert.equal(requests,1);
  assert.match(compiled,/group by grouping sets/i);
  assert.deepEqual(rows.map(row=>row.kind),['source','total']);
});

test('LOC Trace cross-Scope readers are bounded independently of the number of Scopes',async()=>{
  const source=read('app/modular/features/trace/trace-data.js');
  const page=read('app/modular/features/Trace.jsx');
  assert.match(source,/mapBounded\(candidates,3,/);
  assert.match(source,/mapBounded\(await groupTraceSources\(\),3,/);
  assert.match(page,/mapBounded\(locPointGroups,3,/);
  let active=0,max=0;
  await mapBounded(Array.from({length:15},(_,i)=>i),3,async()=>{
    active++;max=Math.max(active,max);
    try{await Promise.resolve();await Promise.resolve();}
    finally{active--;}
  });
  assert.equal(max,3);
});

test('LOC Search still returns the first ordered Scope hit without a bulk content read',async()=>{
  let first=0,other=0;
  const result=await searchOrderedScopeProviders([
    {id:'first',search:async()=>{first++;return {rows:[{uid:'Ab12Cd34',title:'標題'}],hasMore:false}}},
    {id:'other',search:async()=>{other++;return {rows:[],hasMore:false}}}
  ],'關鍵詞',{limit:20});
  assert.equal(first,1);
  assert.equal(other,0);
  assert.equal(result.rows[0].uid,'Ab12Cd34');
  assert.deepEqual(result.nextCursor,{stage:2,offset:0,source:'auto'});
  const code=read('app/loc/galaxy-query.js');
  const search=code.slice(code.indexOf('export async function searchGalaxyRows('),
    code.indexOf('export async function hydrateGalaxySearchRows('));
  assert.doesNotMatch(search,/selectAll\(|columns:\s*['"]\s*\*\s*['"]/);
  assert.match(search,/searchOrderedScopeProviders\(providers,q,/);
});
