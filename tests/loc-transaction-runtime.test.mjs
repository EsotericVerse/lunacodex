import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUidScalarRepairQuery,buildUidCaseRepairQuery,buildUidNativeArrayRepairQuery,repairBeforeUidDelete} from '../app/loc/providers/uid-dependency-before-delete.mjs';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {planJsonRecordsetBatches} from '../app/loc/query/query-batch-size.mjs';
import {planKyselyUpsertBatches}
  from '../app/loc/providers/kysely-runtime.mjs';
import {prepareManagedKyselyWrite}
  from '../app/loc/providers/kysely-management.mjs';

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
test('row-specific Lucus JSON CASE preserves num and full original attr CAS',()=>{
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
  const compiled=buildUidCaseRepairQuery(db,'silver.loc_lucus',items,
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
      table:'lo3rwang_lucus',
      filters:[{column:'uid',operator:'eq',value:'DELE0001'}],
      engine:'postgres'
    }),
    error=>error.httpStatus===409
  );
});

test('JSON recordsets split by UTF-8 bytes, retain input order and preserve columns',()=>{
  const rows=[
    {uid:'AAAA0001',title:'一二三'},
    {uid:'BBBB0002',title:'hello'},
    {uid:'CCCC0003',content:'x'},
    {uid:'DDDD0004',content:'y'},
    {uid:'EEEE0005',title:'last'}
  ];
  const chunks=planJsonRecordsetBatches(rows,{maxBytes:65,groupByShape:true});
  assert.deepEqual(chunks.flatMap(chunk=>JSON.parse(chunk.serialized)),rows);
  assert.equal(chunks.reduce((sum,chunk)=>sum+chunk.rowCount,0),rows.length);
  assert.ok(chunks.every(chunk=>chunk.bytes<=65));
  for(const chunk of chunks){
    assert.equal(chunk.bytes,new TextEncoder().encode(chunk.serialized).byteLength);
    assert.deepEqual(chunk.columns,Object.keys(JSON.parse(chunk.serialized)[0]));
  }
  const large={uid:'BIGG0001',content:'大型文章'.repeat(20)};
  const oversized=planJsonRecordsetBatches([large,rows[0]],{maxBytes:32});
  assert.equal(oversized[0].rowCount,1);
  assert.deepEqual(oversized.flatMap(chunk=>JSON.parse(chunk.serialized)),
    [large,rows[0]]);
  assert.deepEqual(planJsonRecordsetBatches([],{}),[]);
  assert.throws(()=>planJsonRecordsetBatches(rows,{maxBytes:0}));
});

