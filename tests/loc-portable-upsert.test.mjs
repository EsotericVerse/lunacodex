import test from 'node:test';
import assert from 'node:assert/strict';
import {Kysely,MssqlDialect,MysqlDialect} from 'kysely';
import {executeKyselyQuery,executeMssqlUpsert,buildKyselySelectQuery}
  from '../app/loc/providers/kysely-runtime.mjs';
import {executeCrossEngineManagedWrite}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';

// The SQL Server query compiler and transaction wrapper are real Kysely.
// Only the remote driver's I/O is replaced, so no tedious/tarn installation
// or database is required to verify SQL shape and transaction ownership.
function transactionDb(dialect,connection,statements){
  return new Kysely({dialect:{
    createDriver:()=>({
      async init(){},
      async acquireConnection(){return connection;},
      async beginTransaction(){statements.push({sql:'begin'});},
      async commitTransaction(){statements.push({sql:'commit'});},
      async rollbackTransaction(){statements.push({sql:'rollback'});},
      async releaseConnection(){},
      async destroy(){}
    }),
    createAdapter:()=>dialect.createAdapter(),
    createIntrospector:k=>dialect.createIntrospector(k),
    createQueryCompiler:()=>dialect.createQueryCompiler()
  }});
}

function database(seed=[]){
  const records=new Map(seed.map(row=>[row.uid,{...row}]));
  const statements=[];
  const dialect=new MssqlDialect({tedious:{},tarn:{}});
  const connection={
    async executeQuery(query){
      const q=query.sql.toLowerCase(),params=query.parameters;
      statements.push({sql:query.sql,parameters:[...params]});
      if(q.includes('with (updlock,holdlock)')){
        const uid=params.at(-1),row=records.get(uid);
        return {rows:row?[{uid:row.uid}]:[]};
      }
      if(q.startsWith('insert ')){
        const uid=params[0],title=params[1];
        if(records.has(uid))throw Error('Duplicate primary key');
        records.set(uid,{uid,title});
        return {rows:q.includes(' output ')?[{uid,title}]:[],numAffectedRows:1n};
      }
      if(q.startsWith('update ')){
        const uid=params.at(-1),stored=records.get(uid);
        if(!stored)return {rows:[],numAffectedRows:0n};
        stored.title=params[0];
        return {rows:q.includes(' output ')?[{...stored}]:[],numAffectedRows:1n};
      }
      throw Error('Unexpected SQL statement: '+query.sql);
    },
    async *streamQuery(){throw Error('Streaming not expected');}
  };
  const db=transactionDb(dialect,connection,statements);
  return {db,records,statements};
}
function request(uid,title,extra={}){
  return {kind:'query',operation:'upsert',schema:'silver',
    table:'lo3rwang_galaxy',values:{uid,title},onConflict:['uid'],
    columns:['uid','title'],...extra};
}

test('SQL Server primary-key UPSERT executes locked update then insert, no MERGE',async()=>{
  const x=database([{uid:'AAAA0001',title:'before'}]);
  try{
    const output=await x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,{...request('AAAA0001','after'),
        values:[{uid:'AAAA0001',title:'after'},
          {uid:'BBBB0002',title:'new'}]}, {dialect:'mssql',namespace:'dbo'}));
    assert.equal(output.count,2);
    assert.equal(x.records.get('AAAA0001').title,'after');
    assert.equal(x.records.get('BBBB0002').title,'new');
    assert.equal(x.statements.filter(s=>/with \(updlock,holdlock\)/i.test(s.sql)).length,2);
    assert.ok(!x.statements.some(s=>/\bmerge\b/i.test(s.sql)));
    assert.equal(x.statements[0].sql,'begin');
    assert.equal(x.statements.at(-1).sql,'commit');
  }finally{await x.db.destroy();}
});

test('SQL Server UPSERT supports OUTPUT inserted rows',async()=>{
  const x=database();
  try{
    const output=await x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,request('AAAA0001','published',{returning:true}),
        {dialect:'mssql',namespace:'dbo'}));
    assert.deepEqual(output.data,[{uid:'AAAA0001',title:'published'}]);
    assert.ok(x.statements.some(s=>/output\s+.*inserted/i.test(s.sql)));
  }finally{await x.db.destroy();}
});

test('SQL Server UPSERT refuses a root DB or non-modeled conflict keys',async()=>{
  const x=database();
  try{
    await assert.rejects(executeMssqlUpsert(x.db,request('AAAA0001','text')),
      /active Kysely transaction/);
    await assert.rejects(x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,request('AAAA0001','text',{
        onConflict:['site_id']}),{dialect:'mssql',namespace:'dbo'})),
      /exact modeled primary key/);
    assert.equal(x.records.size,0);
  }finally{await x.db.destroy();}
});

test('SQL Server UPSERT rejects duplicate UIDs before changing any row',async()=>{
  const x=database();
  try{
    await assert.rejects(x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,request('AAAA0001','first',{values:[
        {uid:'AAAA0001',title:'first'},
        {uid:'AAAA0001',title:'second'}
      ]}),{dialect:'mssql',namespace:'dbo'})),/Duplicate SQL Server/);
    assert.equal(x.records.size,0);
    assert.ok(!x.statements.some(s=>/with \(updlock,holdlock\)/i.test(s.sql)));
  }finally{await x.db.destroy();}
});

test('SQL Server SELECT does not emit OFFSET 0 without an order',async()=>{
  const x=database();
  try{
    const req={kind:'query',operation:'select',schema:'silver',
      table:'lo3rwang_galaxy',columns:['uid'],limit:10};
    const q=buildKyselySelectQuery(x.db,req,
      {dialect:'mssql',namespace:'dbo'}).query.compile();
    assert.doesNotMatch(q.sql,/offset\s+0\s+rows/i);
    assert.throws(()=>buildKyselySelectQuery(x.db,
      {...req,offset:10},{dialect:'mssql',namespace:'dbo'}),
      /requires an explicit order/);
    const paged=buildKyselySelectQuery(x.db,{
      ...req,offset:10,orders:[{column:'uid',ascending:true}]
    },{dialect:'mssql',namespace:'dbo'}).query.compile();
    assert.match(paged.sql,/order by/i);
    assert.match(paged.sql,/offset\s+@\d+\s+rows/i);
  }finally{await x.db.destroy();}
});


function fixture(initial=[]){
  const rows=new Map(initial.map(row=>[row.uid,{...row}]));
  const statements=[];
  const native=new MysqlDialect({pool:{}});
  const connection={
    async executeQuery(query){
      const stmt=query.sql.toLowerCase(),values=query.parameters;
      statements.push({sql:query.sql,parameters:[...values]});
      if(stmt.startsWith('select ')){
        const uid=values.at(-1);
        const row=[...rows.values()].find(x=>x.uid.toLowerCase()===uid.toLowerCase());
        return {rows:row?[{uid:row.uid}]:[]};
      }
      if(stmt.startsWith('update ')){
        const uid=values.at(-1),row=rows.get(uid);
        if(!row)return {rows:[],numAffectedRows:0n,numChangedRows:0n};
        row.title=values[0];
        return {rows:[],numAffectedRows:1n,numChangedRows:1n};
      }
      if(stmt.startsWith('insert ')){
        const [uid,title]=values;
        if(rows.has(uid))throw Error('Duplicate key');
        rows.set(uid,{uid,title});
        return {rows:[],numAffectedRows:1n};
      }
      throw Error('Unexpected MySQL command: '+query.sql);
    },
    async *streamQuery(){throw Error('Streaming disabled');}
  };
  const db=transactionDb(native,connection,statements);
  return {db,rows,statements};
}

test('MySQL transaction-bound PK upsert updates and inserts without ON DUPLICATE KEY',async()=>{
  const x=fixture([{uid:'AAAA0001',title:'old'}]);
  try{
    const result=await x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,{
        ...request('AAAA0001','new'),values:[
          {uid:'AAAA0001',title:'updated'},
          {uid:'BBBB0002',title:'created'}
        ]},{dialect:'mysql',namespace:''}));
    assert.equal(result.count,2);
    assert.equal(x.rows.get('AAAA0001').title,'updated');
    assert.equal(x.rows.get('BBBB0002').title,'created');
    const lookups=x.statements.filter(x=>x.sql.toLowerCase().startsWith('select '));
    assert.equal(lookups.length,2);
    assert.ok(lookups.every(x=>/for update/i.test(x.sql)));
    assert.ok(x.statements.every(x=>!/on duplicate key|\bmerge\b/i.test(x.sql)));
  }finally{await x.db.destroy();}
});

test('MySQL case-insensitive collation cannot silently change a different Base62 UID',async()=>{
  const x=fixture([{uid:'AbCd0001',title:'original'}]);
  try{
    await assert.rejects(x.db.transaction().execute(trx=>
      executeKyselyQuery(trx,request('abcd0001','incorrect'),
        {dialect:'mysql',namespace:''})),
      /collation does not preserve exact identity/);
    assert.equal(x.rows.get('AbCd0001').title,'original');
    assert.ok(x.statements.some(stmt=>stmt.sql==='rollback'));
  }finally{await x.db.destroy();}
});

test('MySQL prevents UPSERT outside a caller-owned transaction',async()=>{
  const x=fixture();
  try{
    await assert.rejects(executeKyselyQuery(x.db,request('AAAA0001','text'),
      {dialect:'mysql',namespace:''}),/active Kysely transaction/);
    assert.equal(x.statements.length,0);
  }finally{await x.db.destroy();}
});

for(const [engine,namespace,create,lock] of [
  ['mssql','dbo',database,/with \(updlock,holdlock\)/i],
  ['mysql','',fixture,/for update/i]
]){
  test(engine+' managed upsert respects Scope grants and caller-owned transaction',async()=>{
    const x=create();
    const claims={provider:'loc',me:true,sub:'tester_portable',
      email:'portable@example.com',grants:['lo3rwang:manage']};
    try{
      const output=await x.db.transaction().execute(async trx=>{
        bindLocAuthorization(trx,{role:'authenticated',claims,engine});
        return executeCrossEngineManagedWrite(trx,{payload:{
          p_table:'silver.lo3rwang_galaxy',p_operation:'upsert',
          p_rows:[{uid:'AAAA0001',title:'managed'}]
        }},{engine,namespace,role:'authenticated',claims});
      });
      assert.equal(output.data.count,1);
      assert.equal((x.records||x.rows).get('AAAA0001').title,'managed');
      assert.ok(x.statements.some(stmt=>lock.test(stmt.sql)));
    }finally{await x.db.destroy();}
  });
}
