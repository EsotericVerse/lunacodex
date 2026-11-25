import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGalaxyFeatureQuery,executeGalaxyFeatureQuery} from '../app/loc/model/galaxy-feature-queries.mjs';
import {parseGalaxyRecordQuery,executeGalaxyRecordQuery} from '../app/loc/model/galaxy-record-queries.mjs';

const base={kind:'query',operation:'galaxy-feature',scope:'lo3rwang',
  feature:'culture',startDate:'2026-01-01',endDate:'2026-12-31',result:'uids'};
test('no arbitrary SQL, relation, column or filter passes the feature query model',()=>{
  for(const extra of [
    {sql:'DELETE FROM silver.lo3rwang_galaxy'},
    {table:'api.manage'},{columns:['email']},{filters:[]},
    {feature:'other'},{scope:'admin'},{scope:'loc'},
    {startDate:'2026-02-30'},{startDate:'2026-12-31',endDate:'2026-01-01'},
    {category:{type:'source',value:'vocus',sql:'SELECT'}},
    {category:{type:'place',value:'invalid'}},{limit:101},
    {result:'count',cursor:'AAAA0001'}
  ]){
    assert.throws(()=>parseGalaxyFeatureQuery({...base,...extra}));
  }
});
test('daily-source model reduces bounded raw rows to source groups and daily totals',async()=>{
  const rows=[
    ...Array.from({length:2},()=>({date:'2026-11-22',site:'vocus'})),
    ...Array.from({length:3},()=>({date:'2026-11-22',site:'threads'}))
  ];
  const calls=[];
  const builder={select(){return this},where(){return this},
    orderBy(...args){calls.push(['orderBy',...args]);return this},
    limit(value){calls.push(['limit',value]);return this},
    offset(value){calls.push(['offset',value]);return this},
    async executeTakeFirst(){calls.push(['count']);return {row_count:rows.length}},
    async execute(){calls.push(['page']);return rows}};
  const data=await executeGalaxyFeatureQuery({selectFrom(){return builder}},
    parseGalaxyFeatureQuery({...base,result:'daily-sources'}));
  assert.equal(calls.filter(x=>x[0]==='count').length,1);
  assert.equal(calls.filter(x=>x[0]==='page').length,1);
  assert.ok(calls.some(x=>x[0]==='orderBy'&&x[1]==='createtime'));
  assert.deepEqual(data.rows,[
    {day:'2026-11-22',kind:'source',category:'threads',item_count:3},
    {day:'2026-11-22',kind:'source',category:'vocus',item_count:2},
    {day:'2026-11-22',kind:'total',category:'文字作品',item_count:5}
  ]);
});
test('public Search rejects site, source, and place selectors before opening SQL',async()=>{
  const requestBase={
    kind:'query',operation:'galaxy-feature',scope:'lo3rwang',
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
    assert.throws(()=>parseGalaxyFeatureQuery(body));
  }
  assert.equal(parseGalaxyFeatureQuery({
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
  const model=parseGalaxyFeatureQuery({
    kind:'query',operation:'galaxy-feature',
    scope:'lo3rwang',feature:'search',text:'星光',
    excludedTerms:['失落'],result:'articles'
  });
  const result=await executeGalaxyFeatureQuery({
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

test('public UID article detail has an enforced SQL list+extract predicate',async()=>{
  const seen=[];
  const query={select(){return this},where(...args){seen.push(args);return this},
    async execute(){return []}};
  const trx={selectFrom(table){assert.equal(table,'silver.lo3rwang_galaxy');return query}};
  const detail=parseGalaxyRecordQuery({kind:'query',operation:'galaxy-records',
    scope:'lo3rwang',view:'detail',uids:['AAAA0001']});
  await executeGalaxyRecordQuery(trx,detail);
  assert.ok(seen.some(args=>args[0]==='list'&&args[1]==='='&&args[2]===true));
  assert.ok(seen.some(args=>args[0]==='extract'&&args[1]==='='&&args[2]===true));
  const before=seen.length;
  await executeGalaxyRecordQuery(trx,{...detail,view:'list'});
  assert.ok(!seen.slice(before).some(args=>args[0]==='extract'));
  seen.length=0;
  await executeGalaxyRecordQuery(trx,{...detail,mode:'editor'});
  assert.ok(!seen.some(args=>args[0]==='extract'));
});
