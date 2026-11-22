import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGalaxyFeatureTransaction,executeGalaxyFeatureTransaction,
  GALAXY_FEATURE_MODELS} from '../app/loc/model/galaxy-feature-transactions.mjs';
import {handleNamedPublicTransaction} from '../app/loc/server/public-named-transactions.mjs';

const base={kind:'transaction',operation:'galaxy-feature',scope:'lo3rwang',
  feature:'culture',startDate:'2026-01-01',endDate:'2026-12-31',result:'uids'};
const request=body=>new Request('https://loc.lo3rwang.cc/api/loc-public-query',{
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
    const response=await handleNamedPublicTransaction(request({...base,...extra}),{},
      {database:()=>{throw Error('SQL must not start')}});
    assert.equal(response.status,400);
  }
});
test('UID list defaults to 100 and rejects larger limits',()=>{
  assert.equal(parseGalaxyFeatureTransaction(base).limit,100);
  assert.equal(parseGalaxyFeatureTransaction({...base,limit:5}).limit,5);
});
test('one feature transaction includes audited request model and scope',async()=>{
  const observed={tables:[],filters:[],levels:[],transactions:0};
  const query={where(...args){observed.filters.push(args);return this},
    select(){return this},orderBy(){return this},limit(){return this},
    async execute(){return [{uid:'AAAA0001'}]}};
  const trx={selectFrom(table){observed.tables.push(table);return query}};
  const db={transaction(){observed.transactions++;return {
    setIsolationLevel(level){observed.levels.push(level);return this},
    execute(fn){return fn(trx)}
  }},async destroy(){}};
  const response=await handleNamedPublicTransaction(request({
    ...base,feature:'trace',category:{type:'place',value:'BBBB0001'}
  }),{},{database:async()=>({engine:'postgres',db,pool:{end:async()=>{}}})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.deepEqual(payload.data.uids,['AAAA0001']);
  assert.equal(payload.transaction.requestedBy,'trace');
  assert.equal(payload.transaction.model,'GalaxyTrace');
  assert.deepEqual(observed.tables,['silver.lo3rwang_galaxy']);
  assert.ok(observed.filters.some(args=>args[0]==='trace'&&args[2]===true));
  assert.ok(observed.filters.some(args=>args[0]==='place_id'&&args[2]==='BBBB0001'));
  assert.deepEqual(observed.levels,['repeatable read']);
  assert.equal(observed.transactions,1);
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
    const response=await handleNamedPublicTransaction(request(body),{},{
      database:()=>{throw Error('Disallowed Search must not open SQL')}
    });
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

test('guest Search UI does not expose site, place or content-type selection',()=>{
  const ui=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  const provider=readFileSync(new URL('../app/loc/galaxy/galaxy-query.js',import.meta.url),'utf8');
  assert.match(ui,/managementMode\?\['type','source','time'\]:\['time'\]/);
  assert.match(ui,/managementMode&&advancedTab==='source'/);
  assert.match(ui,/managementMode&&advancedTab==='type'/);
  assert.match(ui,/搜尋文章標題或內容/);
  const start=provider.indexOf('function genericScopeProviders(scope)');
  const end=provider.indexOf('function normalizeSearch',start);
  assert.ok(start>=0&&end>start);
  const guestProvider=provider.slice(start,end);
  assert.doesNotMatch(guestProvider,/sourceFilter|sourceTaxonomy|excludedSources|placeIds|contentType/);
  assert.match(guestProvider,/feature:'search'/);
});
