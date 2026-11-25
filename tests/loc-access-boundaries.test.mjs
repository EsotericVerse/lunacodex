import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLocSelfPermissions} from '../app/loc/permissions/loc-permissions-server.mjs';
import {LOC_OWNER_EMAIL} from '../app/loc/permissions/loc-business-grants.mjs';
import {loc_access} from '../app/loc/permissions/loc_access.mjs';
import {handleNativeLocOperation,requireManagedActionGrant} from '../app/loc/bridge/native-operations.mjs';
import {withAuthorizedLocRead} from '../app/loc/actions/read-context.mjs';
import {executeManagedKyselyAction} from '../app/loc/providers/kysely-management.mjs';

{

test('feature Server Actions reject missing Scope grants before opening SQL',async()=>{
  let connected=0,read=0;
  const dependencies={
    getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
    verifySession:async request=>{
      assert.equal(request.headers.get('cookie'),'loc_session=opaque');
      return {userId:'USER_NO_SCOPE',email:'ungranted@example.org'};
    },
    openDatabase:async()=>{connected++;throw Error('SQL must stay closed');},
    closeDatabase:async()=>{}
  };
  await assert.rejects(withAuthorizedLocRead({scope:'lo3rwang'},async()=>{
    read++;
  },dependencies),error=>error.httpStatus===403);
  assert.equal(connected,0);
  assert.equal(read,0);
});

test('feature Server Actions refuse an unscoped read before checking identity or opening SQL',async()=>{
  let verified=0,connected=0;
  await assert.rejects(withAuthorizedLocRead({},async()=>{}, {
    getHeaders:async()=>new Headers(),
    verifySession:async()=>{verified++;throw Error('Must reject before session');},
    openDatabase:async()=>{connected++;throw Error('Must reject before SQL');},
    closeDatabase:async()=>{}
  }),error=>error.httpStatus===400);
  assert.equal(verified,0);
  assert.equal(connected,0);
});

test('managed writes reject access outside the authorized Scope',()=>{
  const claims={provider:'loc',role:'authenticated',sub:'USER_SCOPE_ONLY',
    me:true,grants:['lo3rwang:manage','scope:lo3rwang:manage','lo3rwang:write','lo3rwang:read']};
  assert.doesNotThrow(()=>requireManagedActionGrant({name:'fill_galaxy_place',
    args:{p_scope_id:'lo3rwang'}},claims));
  assert.throws(()=>requireManagedActionGrant({name:'fill_galaxy_place',
    args:{p_scope_id:'family'}},claims),error=>error.httpStatus===403);
});

test('authorized feature reads use one direct connection without a read transaction',async()=>{
  let connected=0,closed=0,read=0,transaction=0;
  const db={
    selectFrom(){throw Error('Read callback owns the only query');},
    transaction(){transaction++;throw Error('Read transaction forbidden');}
  };
  const dependencies={
    getHeaders:async()=>new Headers({cookie:'loc_session=opaque'}),
    verifySession:async()=>({userId:'USER_OWNER',email:LOC_OWNER_EMAIL}),
    openDatabase:async()=>{connected++;return {db,engine:'postgres',namespace:'silver'};},
    closeDatabase:async()=>{closed++;}
  };
  const result=await withAuthorizedLocRead({scope:'lo3rwang'},async(_db,port)=>{
    read++;
    assert.equal(port.engine,'postgres');
    return 'feature-result';
  },dependencies);
  assert.equal(result,'feature-result');
  assert.equal(connected,1);
  assert.equal(read,1);
  assert.equal(transaction,0);
  assert.equal(closed,1);
});

test('write dispatcher has no generic read action, including settings reads',async()=>{
  let queried=0;
  const db={selectFrom(){queried++;throw Error('Managed write channel must not read');}};
  for(const [name,args] of [
    ['read_group_members',{p_group_id:'loc'}],
    ['read_loc_source_hierarchy',{}],
    ['read_scope_registry_admin',{}],
    ['find_galaxy_duplicates',{p_scope_id:'loc'}],
    ['search_galaxy_private',{p_scope_id:'loc',p_query:'secret'}],
    ['loc_admin_settings',{p_operation:'read',p_section:'theme'}],
    ['preview_galaxy_place_fill',{p_scope_id:'loc'}],
    ['fill_galaxy_place',{p_scope_id:'loc',p_apply:false}],
    ['bulk_update_galaxy_able',{p_scope_id:'loc',p_apply:false}]
  ]){
    await assert.rejects(executeManagedKyselyAction(db,{name,args}),
      /Unknown Kysely action|LOC settings read actions are closed|Unexpected Kysely action argument/);
  }
  assert.equal(queried,0);
});

test('temporary bulk-write route is closed by default and still authenticates when enabled',async()=>{
  let connected=0;
  const closedRequest=new Request('https://loc.lo3rwang.cc/api/loc-native',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({kind:'short-import',scopeid:'lo3rwang',batch:{}})
  });
  const earlyClosed=await handleNativeLocOperation(closedRequest,{},
    {entrypoint:'loc-native',
      database:async()=>{connected++;throw Error('Closed route reached SQL');}});
  assert.equal(earlyClosed.status,404);
  assert.equal(closedRequest.bodyUsed,false,'default-closed route must not parse a body');
  for(const until of ['not-a-date','2000-01-01T00:00:00Z']){
    const request=new Request('https://loc.lo3rwang.cc/api/loc-native',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({kind:'short-import',scopeid:'lo3rwang',batch:{}})
    });
    const response=await handleNativeLocOperation(request,
      {LOC_BULK_IMPORT_UNTIL:until},{entrypoint:'loc-native',
        database:async()=>{connected++;throw Error('Expired route reached SQL');}});
    assert.equal(response.status,404);
    assert.equal(request.bodyUsed,false);
  }
  const ordinary={kind:'managed-action',scopeid:'lo3rwang',
    name:'fill_galaxy_place',args:{p_scope_id:'lo3rwang',
      p_start_date:'2026-01-01',p_end_date:'2026-01-02',
      p_place:'Tainan',p_expected_count:1}};
  const ordinaryResponse=await handleNativeLocOperation(
    new Request('https://loc.lo3rwang.cc/api/loc-native',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(ordinary)
    }),{}, {database:async()=>{connected++;throw Error('HTTP save must stay closed');}});
  assert.equal(ordinaryResponse.status,404);
  const body={kind:'short-import',scopeid:'lo3rwang',batch:{}};
  const makeRequest=()=>new Request('https://loc.lo3rwang.cc/api/loc-native',{
    method:'POST',headers:{'content-type':'application/json','cookie':'loc_session=present'},
    body:JSON.stringify(body)
  });
  const database=async()=>{connected++;throw Error('Permission gate must run before SQL');};
  const closed=await handleNativeLocOperation(makeRequest(),{},
    {entrypoint:'loc-native',database});
  assert.equal(closed.status,404);
  const opened=await handleNativeLocOperation(makeRequest(),
    {LOC_BULK_IMPORT_UNTIL:'2999-01-01T00:00:00Z'}, {
      database,fetchImpl:async()=>new Response(JSON.stringify({
        session:{id:'session'},user:{id:'unknown-user',email:'unknown@example.org',emailVerified:true}
    }),{status:200,headers:{'content-type':'application/json'}}),
      entrypoint:'loc-native'
    });
  assert.equal(opened.status,403);
  assert.equal(connected,0);

  assert.equal(connected,0);
});
}




{
const origin='https://loc.lo3rwang.cc';
const req=(body,path)=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('permissions response excludes SQL credentials and rejects cross-origin access',async()=>{
  const response=await handleLocSelfPermissions(req({operation:'self'},
    '/api/loc-permissions'),{verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.connectionString,undefined);
  const cross=new Request(origin+'/api/loc-permissions',{method:'POST',
    headers:{origin:'https://evil.example'},body:'{"operation":"self"}'});
  const blocked=await handleLocSelfPermissions(cross,{
    verifySession:async()=>({email:LOC_OWNER_EMAIL})});
  assert.equal(blocked.status,403);
});
}


test('LOC bulk import is bounded, website-only and cannot dispatch arbitrary SQL operations',async()=>{
  const {bulkImportEnvelope,validateBulkImportEnvelope,encodeBulkImport,closedGateImportChunks}=await import('../app/loc/import/bulk-write-contract.mjs');
  const {BULK_IMPORT_MAX_ROWS,BULK_IMPORT_TARGET_BYTES,BULK_IMPORT_MAX_BYTES,IMPORT_WRITE_TARGET_BYTES}=await import('../app/loc/query/query-batch-size.mjs');
  assert.equal(BULK_IMPORT_MAX_ROWS,8192);
  assert.equal(BULK_IMPORT_TARGET_BYTES,16*1024*1024);
  assert.equal(BULK_IMPORT_MAX_BYTES,32*1024*1024);
  const rows=Array.from({length:20},(_,i)=>({uid:String(i).padStart(8,'0'),content:'字'.repeat(16000)}));
  const payload={p_table:'silver.lo3rwang_galaxy',p_operation:'insert',p_rows:rows,p_values:null,p_filters:[]};
  const envelope=bulkImportEnvelope(payload);
  assert.equal(validateBulkImportEnvelope(envelope).kind,'managed-write');
  assert.ok(new TextEncoder().encode(encodeBulkImport(payload)).byteLength>700000);
  const chunks=[...closedGateImportChunks(payload)];
  assert.ok(chunks.length>1);
  assert.deepEqual(chunks.flatMap(chunk=>chunk.p_rows),rows);
  for(const chunk of chunks)assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).byteLength<IMPORT_WRITE_TARGET_BYTES);
  for(const operation of ['delete','upsert','update','append_media_link'])
    assert.throws(()=>bulkImportEnvelope({...payload,p_operation:operation}));
  assert.throws(()=>bulkImportEnvelope({...payload,p_table:'api.manage'}));
  assert.throws(()=>validateBulkImportEnvelope({...envelope,scopeid:'family'}));
  assert.throws(()=>bulkImportEnvelope({...payload,p_rows:Array(8193).fill(rows[0])}));
  let connected=0;
  const database=async()=>{connected++;throw Error('must not connect');};
  const request=(path='/api/loc-native/',extra={})=>new Request('https://loc.lo3rwang.cc'+path,{
    method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(envelope)});
  const closedRequest=request();
  const closed=await handleNativeLocOperation(closedRequest,{}, {entrypoint:'loc-native',database});
  assert.equal(closed.status,404);
  assert.equal((await closed.json()).error.code,'LOC_BULK_IMPORT_CLOSED');
  assert.equal(closedRequest.bodyUsed,false);
  const open={LOC_BULK_IMPORT_UNTIL:'2999-01-01T00:00:00Z'};
  const anonymous=request();
  assert.equal((await handleNativeLocOperation(anonymous,open,{entrypoint:'loc-native',database})).status,401);
  assert.equal(anonymous.bodyUsed,false);
  const cross=request('/api/loc-native/',{origin:'https://evil.example'});
  assert.equal((await handleNativeLocOperation(cross,open,{entrypoint:'loc-native',database})).status,403);
  assert.equal(cross.bodyUsed,false);
  assert.equal((await handleNativeLocOperation(request('/api/las-native/'),open,{entrypoint:'las-native',trustedMcpBridge:true,database})).status,413);
  assert.equal(connected,0);
});
