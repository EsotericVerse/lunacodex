import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCrossEngineQuery as queryCore,assertCrossEnginePublicRead,
  executeCrossEngineManagedWrite as writeCore,
  serializePortableJsonFields,resolveSqlExecutionPort} from '../app/loc/providers/sql-engine-ports.mjs';
import {bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';

test('plain PostgreSQL does not require provider RLS session roles',()=>{
  assert.equal(resolveSqlExecutionPort({engine:'postgres',provider:'custom'}).session,'external-acl');
  assert.equal(resolveSqlExecutionPort({engine:'postgres',provider:'google-cloud-sql'}).session,'external-acl');
  assert.equal(resolveSqlExecutionPort({engine:'postgres',provider:'supabase'}).session,'postgres-rls');
  assert.equal(resolveSqlExecutionPort({engine:'postgres',provider:'neon',rls_enabled:false}).session,'external-acl');
  assert.equal(resolveSqlExecutionPort({engine:'mysql',provider:'custom'}).session,'external-acl');
});
const identity={role:'authenticated',claims:{sub:'user_AbC123',
  provider:'loc',me:true,email:'owner@example.test',grants:['lo3rwang:manage']}};
const root={...identity,claims:{...identity.claims,grants:['global:manage']}};
const denied={...identity,claims:{...identity.claims,grants:[]}};
function authorizeCrossEngineQuery(db,request,principal){
  if(principal)bindLocAuthorization(db,{role:principal.role,claims:principal.claims});
  return queryCore(db,request,principal);
}
function executeCrossEngineManagedWrite(db,request,principal){
  if(principal)bindLocAuthorization(db,{role:principal.role,claims:principal.claims});
  return writeCore(db,request,principal);
}
const query=(table,operation='select')=>({kind:'query',schema:'silver',table,operation});
function registry(rows,{blacklist={email:[]}}={}){
  return {
    fn(name,columns){
      assert.equal(name,'lower');assert.deepEqual(columns,['email']);
      return 'lower(email)';
    },
    selectFrom(table){
      if(table==='silver.loc')return {select(field){
        assert.equal(field,'blacklist');
        return {where(column,op,value){
          assert.equal(column,'id');assert.equal(value,'loc');
          return {executeTakeFirst:async()=>({blacklist})};
        }};
      }};
      assert.equal(table,'api.manage');
      return {select(fields){
        assert.deepEqual(fields,['id','email','manage_role','active']);
        return {where(column,op,value){
          assert.equal(column,'lower(email)');assert.equal(op,'=');
          assert.equal(value,'owner@example.test');
          return {execute:async()=>rows};
        }};
      }};
    }
  };
}

test('public engine reads only reference tables; private Galaxy remains private',async()=>{
  assertCrossEnginePublicRead(query('runes'));
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('lo3rwang_galaxy')),
    /published LOC relation/);
  await assert.rejects(authorizeCrossEngineQuery(registry([]),query('runes','delete')),
    /published LOC relation/);
});
test('verified LOC Scope owner can use generic native Kysely SELECT and writes',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const [table,operation] of [['lo3rwang_galaxy','select'],['lo3rwang_anchor','insert'],
    ['lo3rwang_blocks','update'],['lo3rwang','select']]){
    await authorizeCrossEngineQuery(db,query(table,operation),identity);
  }
});
test('Scope owner cannot mutate registry, global settings, or other Scope',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  for(const table of ['manage','loc','lrunes_galaxy','unknown_table']){
    await assert.rejects(authorizeCrossEngineQuery(db,query(table,'update'),identity),
      /permission denied/);
  }
});
test('inactive Scope grants are denied and forged unsigned identity is denied',async()=>{
  const db=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:false}]);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),denied),
    /permission denied/);
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy','insert'),
    {role:'authenticated',claims:{email:'owner@example.test'}}),
    /Verified LOC delegation/);
});
test('signed root administration can update all LOC Scope relations',async()=>{
  const db=registry([{id:'admin',email:'owner@example.test',
    manage_role:'admin',active:true}]);
  for(const table of ['manage','loc','lrunes_anchor']){
    await authorizeCrossEngineQuery(db,query(table,'update'),root);
  }
});
test('cross-engine ACL has no RPC or raw SQL bypass',async()=>{
  await assert.rejects(authorizeCrossEngineQuery(registry([]),{
    kind:'rpc',schema:'silver',name:'management_write'},identity),/Unsupported cross-engine/);
});

test('portable managed inserts are 50-row Kysely batches; Scope ACL still applies',async()=>{
  const sizes=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(rows){return {executeTakeFirst:async()=>{
      sizes.push(rows.length);
      return {numInsertedOrUpdatedRows:BigInt(rows.length)};
    }};}})
  };
  const rows=Array.from({length:120},(_,i)=>({uid:String(i).padStart(8,'0'),title:'row'}));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },identity);
  assert.deepEqual(sizes,[50,50,20]);
  assert.equal(result.data.count,120);
  await assert.rejects(executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lrunes_galaxy',p_operation:'insert',p_rows:rows.slice(0,1)}
  },identity),/permission denied/);
});

test('portable JSON values are serialized without touching lyrics or PostgreSQL arrays',()=>{
  const row={attr:{date:'2026-11-04'},media_link:['Ab12Cd34'],
    content:'{"not":"a database object"}',title:'hello'};
  const converted=serializePortableJsonFields(row,'mssql');
  assert.equal(converted.attr,'{"date":"2026-11-04"}');
  assert.equal(converted.media_link,'["Ab12Cd34"]');
  assert.equal(converted.content,row.content);
  assert.deepEqual(serializePortableJsonFields(row,'postgres'),row);
});

test('missing LOC delegation grants deny private SQL without a database permission query',async()=>{
  const db=registry([], {blacklist:null});
  await assert.rejects(authorizeCrossEngineQuery(db,query('lo3rwang_galaxy'),denied),
    /permission denied/);
});
test('signed LOC Scope grant works with only delegated Galaxy and Anchor tables',async()=>{
  const db=registry([],{blacklist:null});
  await authorizeCrossEngineQuery(db,query('lo3rwang_galaxy'),identity);
});

test('SQL Server wide inserts stay below the 2,100-parameter statement cap',async()=>{
  const sizes=[],widths=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(batch){return {executeTakeFirst:async()=>{
      sizes.push(batch.length);
      widths.push(Object.keys(batch[0]).length);
      assert.ok(batch.length*Object.keys(batch[0]).length<=2000);
      return {numInsertedOrUpdatedRows:BigInt(batch.length)};
    }};}})
  };
  const rows=Array.from({length:80},(_,i)=>Object.fromEntries([
    ['uid',String(i).padStart(8,'0')],
    ...Array.from({length:59},(_,j)=>['field_'+j,'value'])
  ]));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },{...identity,engine:'mssql',namespace:'dbo'});
  assert.deepEqual(sizes,[33,33,14]);
  assert.deepEqual(widths,[60,60,60]);
  assert.equal(result.data.count,80);
});

test('MySQL retains 50-row batches regardless of the SQL Server width limit',async()=>{
  const sizes=[];
  const db={
    ...registry([{id:'lo3rwang',email:'owner@example.test',
      manage_role:'scope',active:true}]),
    insertInto:()=>({values(rows){return {executeTakeFirst:async()=>{
      sizes.push(rows.length);
      return {numInsertedOrUpdatedRows:BigInt(rows.length)};
    }};}})
  };
  const rows=Array.from({length:70},(_,i)=>Object.fromEntries([
    ['uid',String(i).padStart(8,'0')],
    ...Array.from({length:59},(_,j)=>['field_'+j,'value'])
  ]));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows}
  },{...identity,engine:'mysql',namespace:''});
  assert.deepEqual(sizes,[50,20]);
  assert.equal(result.data.count,70);
});

test('portable repeated media_link imports do not update unchanged JSON arrays',async()=>{
  const stored={uid:'Ab12Cd34',title:'same',content:'same',place_id:null,
    url:null,media_link:'["Aa00Bb11","Cc22Dd33"]'};
  const patches=[];
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table==='dbo.lo3rwang_galaxy')return {
        select(){return this},
        where(){return this},
        execute:async()=>[stored]
      };
      return acl.selectFrom(table);
    },
    updateTable(){return {
      set(patch){patches.push(patch);return this},
      where(){return this},
      executeTakeFirst:async()=>({numUpdatedRows:1n})
    }}
  };
  const request=media=>executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',
      p_rows:[{uid:'Ab12Cd34',media_link:media}]}
  },{...identity,engine:'mssql',namespace:'dbo'});
  const repeated=await request(['Aa00Bb11','Cc22Dd33']);
  assert.equal(repeated.data.count,0);
  assert.equal(patches.length,0);
  const changed=await request(['Aa00Bb11','Cc22Dd33','Ee44Ff55']);
  assert.equal(changed.data.count,1);
  assert.equal(patches.length,1);
  assert.equal(patches[0].media_link,
    '["Aa00Bb11","Cc22Dd33","Ee44Ff55"]');
});

test('portable update comparison does not parse ordinary article strings as JSON',async()=>{
  const stored={uid:'Ab12Cd34',title:'{"key":"value"}',content:'same',
    place_id:null,url:null,media_link:'["Aa00Bb11"]'};
  const patches=[];
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table==='lo3rwang_galaxy')return {
        select(){return this},where(){return this},
        execute:async()=>[stored]
      };
      return acl.selectFrom(table);
    },
    updateTable(){return {
      set(value){patches.push(value);return this},
      where(){return this},
      executeTakeFirst:async()=>({numUpdatedRows:1n})
    }}
  };
  const response=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',
      p_rows:[{uid:'Ab12Cd34',title:'{"key":"value"}',media_link:['Aa00Bb11']}]}
  },{...identity,engine:'mysql',namespace:''});
  assert.equal(response.data.count,0);
  assert.deepEqual(patches,[]);
});

test('portable update_batch selects only requested columns and groups identical changes',async()=>{
  const original=Array.from({length:6},(_,i)=>({
    uid:String(i).padStart(8,'0'),title:'old',content:'large untouched article'
  }));
  const projections=[],updates=[];
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table!=='dbo.lo3rwang_galaxy')return acl.selectFrom(table);
      return {
        select(cols){projections.push(cols);return this},
        where(){return this},
        execute:async()=>original
      };
    },
    updateTable(table){
      assert.equal(table,'dbo.lo3rwang_galaxy');
      const call={};
      return {
        set(values){call.values=values;return this},
        where(column,operator,uids){
          assert.equal(column,'uid');assert.equal(operator,'in');
          call.uids=uids;return this;
        },
        async executeTakeFirst(){
          updates.push(call);return {numUpdatedRows:BigInt(call.uids.length)};
        }
      };
    }
  };
  const rows=original.map(row=>({uid:row.uid,title:'new'}));
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',p_rows:rows}
  },{...identity,engine:'mssql',namespace:'dbo'});
  assert.deepEqual(projections,[['uid','title']]);
  assert.equal(updates.length,1);
  assert.deepEqual(updates[0].uids,rows.map(row=>row.uid));
  assert.equal(updates[0].values.title,'new');
  assert.ok(updates[0].values.UpdateTime instanceof Date);
  assert.equal(result.data.count,6);
});

test('portable update_batch skips unchanged data and protects nonblank place_id',async()=>{
  const original=[
    {uid:'Ab12Cd34',title:'same',place_id:null,media_link:'["A0000001"]'},
    {uid:'Ef56Gh78',title:'same',place_id:'X0000001',media_link:'["A0000001"]'},
    {uid:'Ij90Kl12',title:'same',place_id:null,media_link:'["A0000001"]'}
  ];
  const updates=[],projections=[];
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table!=='lo3rwang_galaxy')return acl.selectFrom(table);
      return {
        select(cols){projections.push(cols);return this},
        where(){return this},execute:async()=>original
      };
    },
    updateTable(){
      const call={};
      return {
        set(values){
          if(typeof values==='function'){
            const fn=Object.assign((name,args)=>({name,args}),{
              coalesce:(...args)=>({name:'coalesce',args})
            });
            const eb={fn,val:value=>({literal:value}),case:()=>({
              when(lhs,op,rhs){
                assert.equal(lhs.name,'trim');
                assert.equal(lhs.args[0].name,'coalesce');
                assert.equal(op,'=');assert.equal(rhs,'');
                return this;
              },
              then(value){this.value=value;return this},
              elseRef(column){this.column=column;return this},
              end(){return {kind:'case',then:this.value,elseRef:this.column}}
            })};
            call.values=values(eb);
          }else call.values=values;
          return this;
        },
        where(column,operator,uids){
          call.column=column;call.operator=operator;call.uids=uids;return this;
        },
        async executeTakeFirst(){
          updates.push(call);return {numUpdatedRows:BigInt(call.uids.length)};
        }
      };
    }
  };
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',p_rows:[
      {uid:'Ab12Cd34',media_link:['A0000001'],place_id:'P0000001'},
      {uid:'Ef56Gh78',media_link:['A0000001'],place_id:'P0000001'},
      {uid:'Ij90Kl12',media_link:['A0000001'],place_id:'P0000001'}
    ]}
  },{...identity,engine:'mysql',namespace:''});
  assert.deepEqual(projections,[['uid','place_id','media_link']]);
  assert.equal(updates.length,1);
  assert.deepEqual(updates[0].uids,['Ab12Cd34','Ij90Kl12']);
  assert.deepEqual(updates[0].values.place_id,{
    kind:'case',then:'P0000001',elseRef:'place_id'
  });
  assert.ok(!Object.hasOwn(updates[0].values,'media_link'));
  assert.equal(result.data.count,2);
});

test('portable grouped updates obey a 50-row SQL parameter bound',async()=>{
  const existing=Array.from({length:121},(_,i)=>({
    uid:String(i).padStart(8,'0'),title:'original'
  }));
  const updates=[];
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table!=='dbo.lo3rwang_galaxy')return acl.selectFrom(table);
      return {select(){return this},where(){return this},execute:async()=>existing};
    },
    updateTable(){
      return {
        set(){return this},
        where(_column,operator,uids){
          assert.equal(operator,'in');updates.push(uids);return this;
        },
        async executeTakeFirst(){
          return {numUpdatedRows:BigInt(updates.at(-1).length)};
        }
      };
    }
  };
  const result=await executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',
      p_rows:existing.map(row=>({uid:row.uid,title:'replacement'}))}
  },{...identity,engine:'mssql',namespace:'dbo'});
  assert.deepEqual(updates.map(uids=>uids.length),[50,50,21]);
  assert.equal(result.data.count,121);
});

test('portable update_batch rejects UID-only rows before reading Galaxy',async()=>{
  let reads=0;
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table!=='lo3rwang_galaxy')return acl.selectFrom(table);
      reads++;throw Error('unnecessary Galaxy read');
    }
  };
  await assert.rejects(executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',
      p_rows:[{uid:'Ab12Cd34'}]}
  },{...identity,engine:'mysql',namespace:''}),/Invalid Galaxy batch row/);
  assert.equal(reads,0);
});

test('portable batch write failures propagate for Gateway transaction rollback',async()=>{
  let updates=0;
  const acl=registry([{id:'lo3rwang',email:'owner@example.test',
    manage_role:'scope',active:true}]);
  const db={
    ...acl,
    selectFrom(table){
      if(table!=='lo3rwang_galaxy')return acl.selectFrom(table);
      return {select(){return this},where(){return this},
        execute:async()=>[
          {uid:'Ab12Cd34',title:'old1'},{uid:'Ef56Gh78',title:'old2'}
        ]};
    },
    updateTable(){
      return {
        set(){return this},where(){return this},
        async executeTakeFirst(){
          updates++;
          if(updates===2)throw Error('simulated database failure');
          return {numUpdatedRows:1n};
        }
      };
    }
  };
  await assert.rejects(executeCrossEngineManagedWrite(db,{
    payload:{p_table:'silver.lo3rwang_galaxy',p_operation:'update_batch',
      p_rows:[{uid:'Ab12Cd34',title:'new1'},{uid:'Ef56Gh78',title:'new2'}]}
  },{...identity,engine:'mysql',namespace:''}),/simulated database failure/);
  assert.equal(updates,2);
});
