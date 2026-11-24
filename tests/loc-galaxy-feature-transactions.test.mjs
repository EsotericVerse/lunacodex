import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction,
  GALAXY_FEATURE_MODELS} from '../app/loc/model/galaxy-feature-transactions.mjs';
import {handleGalaxyFeatureQuery} from '../app/loc/galaxy/feature-query-server.mjs';
import {parseGalaxyRecordTransaction,executeGalaxyRecordTransaction} from '../app/loc/model/galaxy-record-transactions.mjs';
import {galaxyAble} from '../app/loc/model/galaxy-able.mjs';

const base={kind:'transaction',operation:'galaxy-feature',scope:'lo3rwang',
  feature:'culture',startDate:'2026-01-01',endDate:'2026-12-31',result:'uids'};
const request=body=>new Request('https://loc.lo3rwang.cc/galaxy/feature',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(body)});

test('eight fixed Galaxy feature flags match the ZModel contracts',()=>{
  assert.deepEqual(Object.keys(GALAXY_FEATURE_MODELS),
    ['culture','statics','search','trace','list','keyword','extract','others']);
  assert.equal(GALAXY_FEATURE_MODELS.statics.flag,'statics');
});
test('no arbitrary SQL, relation, column or filter passes the transaction boundary',async()=>{
  for(const extra of [
    {sql:'DELETE FROM silver.lo3rwang_galaxy'},
    {table:'api.manage'},{columns:['email']},{filters:[]},
    {feature:'other'},{scope:'admin'},{scope:'loc'},
    {startDate:'2026-02-30'},{startDate:'2026-12-31',endDate:'2026-01-01'},
    {category:{type:'source',value:'vocus',sql:'SELECT'}},
    {category:{type:'place',value:'invalid'}},{limit:101},
    {result:'count',cursor:'AAAA0001'}
  ]){
    assert.throws(()=>parseGalaxyFeatureTransaction({...base,...extra}));
    const response=await handleGalaxyFeatureQuery(request({...base,...extra}),{});
    assert.equal(response.status,400);
  }
});
test('UID list defaults to 100 and rejects larger limits',()=>{
  assert.equal(parseGalaxyFeatureTransaction(base).limit,100);
  assert.equal(parseGalaxyFeatureTransaction({...base,limit:5}).limit,5);
});
test('Galaxy Trace model reads the selected Scope and place directly',async()=>{
  const observed={tables:[],filters:[]};
  const query={where(...args){observed.filters.push(args);return this},
    select(){return this},orderBy(){return this},limit(){return this},
    async execute(){return [{uid:'AAAA0001'}]}};
  const db={selectFrom(table){observed.tables.push(table);return query},
    transaction(){throw Error('Read query opened a transaction')}};
  const result=await executeGalaxyFeatureTransaction(db,parseGalaxyFeatureTransaction({
    ...base,feature:'trace',category:{type:'place',value:'BBBB0001'}
  }));
  assert.deepEqual(result.uids,['AAAA0001']);
  assert.deepEqual(observed.tables,['silver.lo3rwang_galaxy']);
  assert.ok(observed.filters.some(args=>args[0]==='trace'&&args[2]===true));
  assert.ok(observed.filters.some(args=>args[0]==='place_id'&&args[2]==='BBBB0001'));
});

test('the daily-source model returns source groups and daily total in one query',async()=>{
  const rows=[{date:'2026-11-22',site:'vocus',count:2},
    {date:'2026-11-22',site:'suno',count:3}];
  let queries=0;
  const builder={select(){return this},where(){return this},
    groupBy(){return this},orderBy(){return this},
    async execute(){queries++;return rows}};
  const trx={selectFrom(){return builder}};
  const data=await executeGalaxyFeatureTransaction(trx,{
    ...parseGalaxyFeatureTransaction({...base,result:'daily-sources'})
  });
  assert.equal(queries,1);
  assert.deepEqual(data.rows,[
    {day:'2026-11-22',kind:'source',category:'suno',item_count:3},
    {day:'2026-11-22',kind:'source',category:'vocus',item_count:2},
    {day:'2026-11-22',kind:'total',category:'文字作品',item_count:5}
  ]);
});

test('every Galaxy flag is a typed model; articles require the independent list gate',()=>{
  for(const flag of ['culture','statics','search','trace','list','keyword','extract','others']){
    const parsed=parseGalaxyFeatureTransaction({...base,feature:flag});
    assert.equal(parsed.feature,flag);
  }
  for(const view of ['articles','uids']){
    const parsed=parseGalaxyFeatureTransaction({...base,feature:'others',result:view});
    assert.equal(parsed.limit,100);
  }
});

test('public Search rejects site, source, and place selectors before opening SQL',async()=>{
  const requestBase={
    kind:'transaction',operation:'galaxy-feature',scope:'lo3rwang',
    feature:'search',text:'星光',result:'articles'
  };
  const selectors=[
    {category:{type:'source',value:'Suno'}},
    {category:{type:'place',value:'AAAA0001'}},
    {sources:['Facebook']},{excludedSources:['Vocus']},
    {placeIds:['AAAA0001']}
  ];
  for(const extra of selectors){
    const body={...requestBase,...extra};
    assert.throws(()=>parseGalaxyFeatureTransaction(body));
    const response=await handleGalaxyFeatureQuery(request(body),{});
    assert.equal(response.status,400);
  }
  assert.equal(parseGalaxyFeatureTransaction({
    ...requestBase,startDate:'2026-01-01',endDate:'2026-11-22'
  }).feature,'search');
});

test('public Search matches title OR content, with no user-chosen metadata field',async()=>{
  const observed=[];
  const eb=(column,operator,value)=>({column,operator,value});
  eb.or=items=>({operation:'or',items});
  eb.and=items=>({operation:'and',items});
  eb.fn=(name,fields)=>({fn:name,fields});
  const builder={
    where(column,operator,value){
      observed.push(typeof column==='function'?column(eb):{column,operator,value});
      return this;
    },
    select(){return this},orderBy(){return this},limit(){return this},
    offset(){return this},
    async execute(){return [{
      uid:'AAAA0001',title:'星光',content:null,site:'Vocus',list:true
    }]}
  };
  const model=parseGalaxyFeatureTransaction({
    kind:'transaction',operation:'galaxy-feature',
    scope:'lo3rwang',feature:'search',text:'星光',
    excludedTerms:['失落'],result:'articles'
  });
  const result=await executeGalaxyFeatureTransaction({
    selectFrom(table){
      assert.equal(table,'silver.lo3rwang_galaxy');
      return builder;
    }
  },model);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].title,'星光');
  const clauses=JSON.stringify(observed);
  assert.match(clauses,/"column":"title","operator":"ilike","value":"%星光%"/);
  assert.match(clauses,/"column":"content","operator":"ilike","value":"%星光%"/);
  assert.match(clauses,/"column":"title","operator":"not ilike","value":"%失落%"/);
  assert.match(clauses,/"column":"content","operator":"not ilike","value":"%失落%"/);
  assert.doesNotMatch(clauses,/"column":"location"/);
  assert.doesNotMatch(clauses,/"column":"place_id"/);
});

test('MCP defaults are listable and nonextractable; all eight flags stay independent',()=>{
  const attrs=galaxyAble({site:'mcp'});
  assert.equal(Object.keys(attrs).length,8);
  assert.equal(attrs.list,true);
  assert.equal(attrs.extract,false);
  assert.equal(attrs.search,true);
  assert.equal(attrs.culture,true);
  assert.equal(galaxyAble({site:'mcp',list:false,extract:false}).list,false);
  assert.equal(galaxyAble({site:'mcp',list:true,extract:true}).extract,true);
});

test('public UID article detail has an enforced SQL list+extract predicate',async()=>{
  const seen=[];
  const query={select(){return this},where(...args){seen.push(args);return this},
    async execute(){return []}};
  const trx={selectFrom(table){assert.equal(table,'silver.lo3rwang_galaxy');return query}};
  const detail=parseGalaxyRecordTransaction({kind:'transaction',operation:'galaxy-records',
    scope:'lo3rwang',view:'detail',uids:['AAAA0001']});
  await executeGalaxyRecordTransaction(trx,detail);
  assert.ok(seen.some(args=>args[0]==='list'&&args[1]==='='&&args[2]===true));
  assert.ok(seen.some(args=>args[0]==='extract'&&args[1]==='='&&args[2]===true));
  const before=seen.length;
  await executeGalaxyRecordTransaction(trx,{...detail,view:'list'});
  assert.ok(!seen.slice(before).some(args=>args[0]==='extract'));
  seen.length=0;
  await executeGalaxyRecordTransaction(trx,{...detail,mode:'editor'});
  assert.ok(!seen.some(args=>args[0]==='extract'));
});

test('MCP public content uses the independent extract flag',()=>{
  const mcp=readFileSync(new URL('../app/loc/mcp/galaxy-read.mjs',import.meta.url),'utf8');
  assert.match(mcp,/\.where\('extract','=',true\)/);
});
