import test from 'node:test';
import assert from 'node:assert/strict';
import {Kysely,MysqlDialect} from 'kysely';
import {executeKyselyQuery} from '../app/loc/providers/kysely-runtime.mjs';
import {executeCrossEngineManagedWrite}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';

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
  const db=new Kysely({dialect:{
    createDriver:()=>({
      async init(){},async acquireConnection(){return connection;},
      async beginTransaction(){statements.push({sql:'begin'});},
      async commitTransaction(){statements.push({sql:'commit'});},
      async rollbackTransaction(){statements.push({sql:'rollback'});},
      async releaseConnection(){},async destroy(){}
    }),
    createAdapter:()=>native.createAdapter(),
    createIntrospector:k=>native.createIntrospector(k),
    createQueryCompiler:()=>native.createQueryCompiler()
  }});
  return {db,rows,statements};
}
const request=(uid,title)=>({
  kind:'query',operation:'upsert',schema:'silver',
  table:'lo3rwang_galaxy',values:{uid,title},
  onConflict:['uid'],columns:['uid','title']
});

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

test('MySQL managed upsert respects signed Scope grants and uses primary-key locking',async()=>{
  const x=fixture();
  const claims={provider:'loc',me:true,sub:'tester_portable',
    email:'portable@example.com',grants:['lo3rwang:manage']};
  try{
    const output=await x.db.transaction().execute(async trx=>{
      bindLocAuthorization(trx,{role:'authenticated',claims,engine:'mysql'});
      return executeCrossEngineManagedWrite(trx,{payload:{
        p_table:'silver.lo3rwang_galaxy',p_operation:'upsert',
        p_rows:[{uid:'AAAA0001',title:'managed'}]
      }},{engine:'mysql',namespace:'',role:'authenticated',claims});
    });
    assert.equal(output.data.count,1);
    assert.equal(x.rows.get('AAAA0001').title,'managed');
    assert.ok(x.statements.some(stmt=>/for update/i.test(stmt.sql)));
  }finally{await x.db.destroy();}
});
