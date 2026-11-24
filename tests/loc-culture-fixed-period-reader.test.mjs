import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAnchorFeatureQuery,executeAnchorFeatureQuery}
  from '../app/loc/model/anchor-feature-queries.mjs';
import {parseGalaxyFeatureQuery}
  from '../app/loc/model/galaxy-feature-queries.mjs';
import {TIME_ANCHOR_MAX_PAGE_ROWS} from '../app/loc/query/query-batch-size.mjs';

const base={kind:'query',operation:'anchor-feature',scope:'lo3rwang',
  family:'media',types:['suno'],startDate:'2026-11-01',endDate:'2026-11-22',
  order:'createtime',sortDirection:'desc',offset:10,limit:100,includeTotal:true};
test('fixed media window validates dates and limits before opening SQL',()=>{
  const parsed=parseAnchorFeatureQuery(base);
  assert.equal(parsed.order,'createtime');
  for(const patch of [
    {startDate:'2026-02-30'},{endDate:'2026-01-01'},
    {family:'space',startDate:'2026-01-01'},
    {limit:TIME_ANCHOR_MAX_PAGE_ROWS+1},{types:['arbitrary']},
    {cursor:'ABCD1234',order:'createtime'},
    {result:'count',includeTotal:true},{result:'count',offset:10}
  ])assert.throws(()=>parseAnchorFeatureQuery({...base,...patch}));
});
test('fixed media Anchor query uses direct selects without a SQL transaction',async()=>{
  const used={tables:[],where:[],sort:[],offset:[],limits:[],count:0};
  const q={where(...args){used.where.push(args);return this},
    select(value){if(typeof value==='function')used.count++;return this},
    orderBy(...args){used.sort.push(args);return this},
    offset(x){used.offset.push(x);return this},
    limit(x){used.limits.push(x);return this},
    async executeTakeFirst(){return {total:'205'}},
    async execute(){return [{uid:'ABCD1234',createtime:'2026-11-01T00:00:00Z'}]}};
  const db={selectFrom(table){used.tables.push(table);return q},
    transaction(){used.transactions++;throw Error('Read query opened a transaction')}};
  used.transactions=0;
  const data=await executeAnchorFeatureQuery(db,parseAnchorFeatureQuery(base));
  assert.equal(data.totalCount,205);
  assert.equal(data.rows.length,1);
  assert.deepEqual(used.tables,['silver.lo3rwang_anchor']);
  assert.ok(used.where.some(args=>args[0]==='createtime'&&args[1]==='>='));
  assert.ok(used.where.some(args=>args[0]==='createtime'&&args[1]==='<='));
  assert.ok(used.where.some(args=>args[0]==='invisible'&&args[2]===false));
  assert.deepEqual(used.sort[0],['createtime','desc']);
  assert.deepEqual(used.offset,[10]);
  assert.deepEqual(used.limits,[101]);
  assert.equal(used.count,1);
  assert.equal(used.transactions,0);
});
test('Culture/Statistics period lists may opt into Galaxy indexed date sorting',()=>{
  const input={kind:'query',operation:'galaxy-feature',scope:'lo3rwang',
    feature:'culture',result:'articles',orderByDate:true,startDate:'2026-01-01'};
  assert.equal(parseGalaxyFeatureQuery(input).orderByDate,true);
  assert.throws(()=>parseGalaxyFeatureQuery({...input,result:'count'}));
});
