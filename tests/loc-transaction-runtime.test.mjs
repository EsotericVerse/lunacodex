import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planUidScalarRepairBatches,buildUidScalarRepairQuery,
  planUidRepairStatementBatches,buildUidCaseRepairQuery,
  buildUidNativeArrayRepairQuery,repairBeforeUidDelete}
  from '../app/loc/providers/uid-dependency-before-delete.mjs';
import {planUidDependencyRepair}
  from '../app/loc/providers/uid-dependency-immer.mjs';
import {planImportPointCreate,planImportDateCreate,planImportDateTitleDelta}
  from '../app/loc/import/point-date-immer.mjs';
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect,sql} from 'kysely';
import {remapImportUidRelations,planImportPointUidLink,planImportMediaUrlLinks,
  planExistingImportUidUpdate} from '../app/loc/import/uid-delta.mjs';
import {planKyselyUpsertBatches,buildKyselyUpsertQuery}
  from '../app/loc/providers/kysely-runtime.mjs';
import {prepareManagedKyselyWrite}
  from '../app/loc/providers/kysely-management.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('UPSERT batches preserve order and split duplicate primary keys',()=>{
  const rows=[
    {uid:'AAAA0001',title:'one'}, {uid:'BBBB0002',title:'two'},
    {uid:'AAAA0001',title:'three'}, {uid:'CCCC0003',title:'four',content:'x'},
    {uid:'DDDD0004',title:'five',content:'y'}
  ];
  const batches=planKyselyUpsertBatches(rows,'uid');
  assert.deepEqual(batches.map(b=>b.map(row=>row.uid)),
    [['AAAA0001','BBBB0002'],['AAAA0001'],['CCCC0003','DDDD0004']]);
  assert.deepEqual(batches.flat(),rows);
});
test('UPSERT batches obey parameter and byte budgets',()=>{
  const rows=Array.from({length:11},(_,i)=>({uid:String(i).padStart(8,'0'),title:'some title'}));
  const batches=planKyselyUpsertBatches(rows,'uid',{maxParameters:6,maxBytes:1000});
  assert.ok(batches.every(batch=>batch.length<=3));
  assert.deepEqual(batches.flat(),rows);
  assert.ok(planKyselyUpsertBatches(rows,'uid',{maxBytes:30}).length>1);
});
test('Kysely native PG UPSERT uses row-specific EXCLUDED references',()=>{
  const db=new Kysely({dialect:new PostgresDialect({pool:{
    connect:async()=>{throw Error('Compile-only test must not connect');}
  }})});
  const query=buildKyselyUpsertQuery(db,{
    schema:'silver',table:'lo3rwang_galaxy',
    values:[{uid:'AAAA0001',title:'one'},{uid:'BBBB0002',title:'two'}],
    onConflict:['uid']
  },'postgres');
  const compiled=query.compile();
  assert.match(compiled.sql,/on conflict/i);
  assert.match(compiled.sql,/excluded.*title/i);
  assert.equal(compiled.parameters.length,4);
});
test('pure managed validation does not mutate the request payload',()=>{
  const input={kind:'managed-write',payload:{
    p_table:'silver.lo3rwang_galaxy',p_operation:'update',
    p_values:{title:'new title'},p_filters:[{column:'uid',operator:'eq',value:'AAAA0001'}]
  }};
  const plan=prepareManagedKyselyWrite(input);
  assert.notEqual(plan.values,input.payload.p_values);
  assert.deepEqual(input.payload.p_values,{title:'new title'});
  assert.equal(plan.table,'lo3rwang_galaxy');
  assert.throws(()=>prepareManagedKyselyWrite({payload:{
    p_table:'silver.lo3rwang_galaxy',p_operation:'delete',p_filters:[]
  }}),/filters|filter/i);
});
test('LOC validates writes before transaction and leaves grants on trx',()=>{
  const native=source('app/loc/mcp/native-operations.mjs');
  assert.ok(native.indexOf('const preparedWrites=')<native.indexOf("if(body.kind==='managed-transaction'){",
    native.indexOf('const preparedWrites=')));
  assert.match(native,/bindLocAuthorization\(trx/);
  assert.match(native,/transaction\(\)\.execute\(async trx=>/);
  const m=source('app/loc/providers/kysely-management.mjs');
  assert.match(m,/await authorizeRelation\(trx,table,operation/);
  assert.match(m,/\.forUpdate\(\)/);
});

test('scalar UID repair coalesces exact-CAS rows, but not array or mixed patches',()=>{
  const deleted='DELE0001';
  const scalar=Array.from({length:2501},(_,i)=>({
    uid:String(i).padStart(8,'0'),
    values:{place_id:null},expected:{place_id:deleted}
  }));
  const mixed={uid:'MIXD0001',
    values:{source_id:null,target_id:['REMA0001']},
    expected:{source_id:deleted,target_id:['DELE0001','REMA0001']}};
  const malformed={uid:'CASX0001',
    values:{source_id:null},expected:{source_id:'OTHR0001'}};
  const plan=planUidScalarRepairBatches([...scalar,mixed,malformed],deleted);
  assert.deepEqual(plan.batches.map(batch=>batch.uids.length),[1000,1000,501]);
  assert.deepEqual(plan.singles,[mixed,malformed]);
  // 2,503 prior per-row UPDATEs become 3 set-based + 2 CAS UPDATEs.
  assert.equal(plan.batches.length+plan.singles.length,5);
});
test('Kysely scalar UID UPDATE compiles bound PK and old-reference predicates',()=>{
  const db=new Kysely({dialect:new PostgresDialect({pool:{
    connect:async()=>{throw Error('Compile-only test must not connect');}
  }})});
  const batch={fields:['source_id','ref_id'],uids:['AAAA0001','BBBB0002']};
  const query=buildUidScalarRepairQuery(db,'silver.lo3rwang_galaxy',batch,'DELE0001');
  const compiled=query.compile();
  assert.match(compiled.sql,/update/i);
  assert.match(compiled.sql,/source_id.*=.*ref_id|source_id/i);
  assert.match(compiled.sql,/where .*uid.* in /i);
  assert.match(compiled.sql,/source_id.*=.*and.*ref_id.*=/i);
  assert.deepEqual(compiled.parameters.slice(-4),
    ['AAAA0001','BBBB0002','DELE0001','DELE0001']);
  assert.equal(compiled.parameters.at(-1),'DELE0001');
});
test('Point and Date import CREATE use direct envelopes without Immer drafts',()=>{
  const point=planImportPointCreate({uid:'POIN0001',title:'Point',
    description:'',coordinates:[121.2,25.1],createtime:'2026-11-23T00:00:00Z'});
  assert.deepEqual(point.row,{uid:'POIN0001',type:'point',title:'Point',
    description:'',attr:{longitude:121.2,latitude:25.1},invisible:false,
    createtime:'2026-11-23T00:00:00Z'});
  assert.deepEqual(point.patches,[]);
  const date=planImportDateCreate({uid:'DATE0001',date:'2026-11-23',
    title:'Day',description:'Test'});
  assert.deepEqual(date.row,{uid:'DATE0001',type:'date',
    attr:{date:'2026-11-23'},invisible:false,title:'Day',description:'Test'});
  assert.deepEqual(date.patches,[]);
  assert.throws(()=>planImportPointCreate({uid:'POIN0001',coordinates:['bad',2]}));
});
test('Trace segment repair keeps endpoint pairs and anchor count',()=>{
  const plan=planUidDependencyRepair({deletedUid:'POIN0002',
    deletedTable:'anchor',deletedType:'point',anchorRows:[{
      uid:'TRAC0001',type:'trace',
      attr:{point:['POIN0001','POIN0002','POIN0003','POIN0004'],path:[]}
    }]});
  assert.equal(plan.anchorUpdates.length,1);
  assert.deepEqual(plan.anchorUpdates[0].values.attr.point,['POIN0003','POIN0004']);
  assert.equal(plan.anchorUpdates[0].values.num,2n);
  assert.deepEqual(plan.anchorUpdates[0].expected.attr.point,
    ['POIN0001','POIN0002','POIN0003','POIN0004']);
});

test('native target UID ARRAY update retains every old-value CAS predicate',()=>{
  const db=new Kysely({dialect:new PostgresDialect({pool:{
    connect:async()=>{throw Error('compile-only');}
  }})});
  const items=[
    {uid:'AAAA0001',values:{source_id:null,target_id:['BBBB0002']},
      expected:{source_id:'DELE0001',target_id:['DELE0001','BBBB0002','DELE0001']}},
    {uid:'CCCC0003',values:{source_id:null,target_id:['BBBB0002']},
      expected:{source_id:'DELE0001',target_id:['DELE0001','BBBB0002']}}
  ];
  const compiled=buildUidNativeArrayRepairQuery(db,'silver.loc_galaxy',
    items,'DELE0001').compile();
  assert.match(compiled.sql,/array_remove/i);
  assert.match(compiled.sql,/source_id/i);
  assert.match(compiled.sql,/target_id.*=/i);
  assert.match(compiled.sql,/ or /i);
  assert.ok(compiled.parameters.includes('AAAA0001'));
  assert.ok(compiled.parameters.includes('CCCC0003'));
  assert.ok(compiled.parameters.some(v=>Array.isArray(v)&&v.length===3),
    JSON.stringify({sql:compiled.sql,parameters:compiled.parameters}));
});
test('row-specific Anchor JSON CASE preserves num and full original attr CAS',()=>{
  const db=new Kysely({dialect:new PostgresDialect({pool:{
    connect:async()=>{throw Error('compile-only');}
  }})});
  const items=[
    {uid:'AAAA0001',type:'path',
      values:{attr:{point:['11111111','22222222']},num:2n},
      expected:{attr:{point:['11111111','33333333','22222222']}}},
    {uid:'BBBB0002',type:'path',
      values:{attr:{point:['44444444','55555555']},num:2n},
      expected:{attr:{point:['44444444','33333333','55555555']}}}
  ];
  const serialize=values=>Object.fromEntries(Object.entries(values).map(
    ([key,value])=>[key,key==='attr'?sql`${JSON.stringify(value)}::jsonb`:value]));
  const compiled=buildUidCaseRepairQuery(db,'silver.loc_anchor',items,
    serialize).compile();
  assert.match(compiled.sql,/CASE/i);
  assert.match(compiled.sql,/::jsonb/i);
  assert.match(compiled.sql,/num/i);
  assert.match(compiled.sql,/where /i);
  assert.ok(compiled.parameters.includes('AAAA0001'));
  assert.ok(compiled.parameters.includes('BBBB0002'));
  assert.ok(compiled.parameters.includes('path'));
  assert.ok(compiled.parameters.includes(2n));
  assert.ok(compiled.parameters.includes(JSON.stringify(items[0].expected.attr)));
  assert.ok(compiled.parameters.includes(JSON.stringify(items[1].expected.attr)));
});
test('large UID reconciliations use bounded batches and preserve every row',()=>{
  const rows=Array.from({length:101},(_,i)=>({
    uid:String(i).padStart(8,'0'),type:'trace',
    values:{attr:{point:['AAAA0001','BBBB0002']},num:2n},
    expected:{attr:{point:['AAAA0001','DELE0001','BBBB0002','DELE0001']}}
  }));
  const batches=planUidRepairStatementBatches(rows,{maxRows:25});
  assert.deepEqual(batches.map(b=>b.length),[25,25,25,25,1]);
  assert.deepEqual(batches.flat(),rows);
  assert.equal(planUidRepairStatementBatches(rows,{maxBytes:1}).length,rows.length);
  assert.ok(planUidRepairStatementBatches(rows,{maxParameters:14}).length>=50);
  assert.throws(()=>planUidRepairStatementBatches(rows,{maxParameters:0}));
  // Default size follows SQL parameters and serialized payload, not a
  // hardcoded row count such as 50/64/100.
  assert.equal(planUidRepairStatementBatches(rows).flat().length,rows.length);
});

test('UID alias remapping preserves article content, target order and saved IDs',()=>{
  const aliases=new Map([['AAAA0001','BBBB0002'],['CCCC0003','BBBB0002']]);
  const row={uid:'ROWX0001',content:'unchanged long article',
    source_id:'AAAA0001',ref_id:null,
    target_id:['AAAA0001','CCCC0003','DDDD0004']};
  const out=remapImportUidRelations([row],{aliases});
  assert.deepEqual(out.rows[0].target_id,['BBBB0002','DDDD0004']);
  assert.equal(out.rows[0].source_id,'BBBB0002');
  assert.equal(out.rows[0].content,row.content);
  assert.deepEqual(out.changesByUid.get('ROWX0001').changes,{
    source_id:'BBBB0002',target_id:['BBBB0002','DDDD0004']
  });
  assert.deepEqual(remapImportUidRelations([row]).rows,[row]);
  assert.throws(()=>remapImportUidRelations([row],{
    aliases:new Map([['AAAA0001','BBBB0002'],['BBBB0002','AAAA0001']])
  }),/循環/);
});
test('simple Point, Date and URL deltas avoid drafts but retain write shapes',()=>{
  assert.deepEqual(planImportPointUidLink(null,'POIN0001').changes,
    {place_id:'POIN0001'});
  assert.equal(planImportPointUidLink('POIN0001','POIN0001').patches.length,0);
  assert.deepEqual(planImportMediaUrlLinks(
    ['https://example.com/old','https://example.com/article'],
    ['https://example.com/old','https://example.com/new'],
    'https://example.com/article').changes,
    {media_link:['https://example.com/old','https://example.com/new']});
  assert.deepEqual(planImportDateTitleDelta(
    {uid:'DATE0001',type:'date',title:'2026-11-23',description:''},
    {title:'Imported',description:'Text'},'2026-11-23').changes,
    {title:'Imported',description:'Text'});
  assert.deepEqual(planExistingImportUidUpdate(
    {source_id:'BBBB0002',ref_id:null,target_id:[],place_id:null},
    {source_id:'ZZZZ0009',ref_id:'AAAA0001',target_id:[]}
  ).changes,{ref_id:'AAAA0001'});
});

test('portable Kysely CASE compiles for MySQL and SQL Server without connections',()=>{
  const item={uid:'AAAA0001',type:'trace',
    values:{attr:{point:['BBBB0002','CCCC0003']},num:2n},
    expected:{attr:{point:['BBBB0002','DELE0001','CCCC0003','DELE0001']}}};
  const configs=[
    ['mysql',new MysqlDialect({pool:{}}),'loc_anchor'],
    ['mssql',new MssqlDialect({tarn:{},tedious:{}}),'dbo.loc_anchor']
  ];
  for(const [engine,dialect,relation] of configs){
    const db=new Kysely({dialect});
    const compiled=buildUidCaseRepairQuery(db,relation,[item],
      values=>Object.fromEntries(Object.entries(values).map(
        ([key,value])=>[key,key==='attr'?JSON.stringify(value):value]))).compile();
    assert.match(compiled.sql,/case/i,engine);
    assert.match(compiled.sql,/where/i,engine);
    assert.ok(compiled.parameters.includes('AAAA0001'),engine);
    assert.ok(compiled.parameters.includes(JSON.stringify(item.expected.attr)),engine);
  }
});
test('UID delete refuses an incomplete CAS batch with conflict status',async()=>{
  const update=()=>{
    const q={set:()=>q,where:()=>q,executeTakeFirst:async()=>({numUpdatedRows:0n})};
    return q;
  };
  const select=table=>{
    const q={
      select:()=>q,where:()=>q,
      executeTakeFirst:async()=>({uid:'DELE0001',type:'point'}),
      execute:async()=>table.includes('galaxy')
        ?[{uid:'AAAA0001',place_id:'DELE0001'}]:[]
    };
    return q;
  };
  const db={selectFrom:select,updateTable:update};
  await assert.rejects(
    repairBeforeUidDelete(db,{
      table:'lo3rwang_anchor',
      filters:[{column:'uid',operator:'eq',value:'DELE0001'}],
      engine:'postgres'
    }),
    error=>error.httpStatus===409
  );
});
