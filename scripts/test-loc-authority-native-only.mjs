import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {issueDelegation,verifyDelegationBoundary,canManageDelegation}
  from '../app/loc/auth/delegation-contract.mjs';
import {normalizeSqlDriverAuthentication,publicSqlDriverAuthentication,
  sqlAuthNeedsUserPassword} from '../app/loc/providers/sql-driver-auth.mjs';
import {sqlTargetRevision,sqlSourceKey,reserveSqlProbe,finishSqlProbe,
  sqlVerificationAllowed,SQL_PROBE_COOLDOWN_MS,SQL_PROBE_WINDOW_MS}
  from '../workers/loc-authority/sql-source-gate.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC Authority verifies only signed native login identities',()=>{
  const worker=read('workers/loc-authority/index.mjs');
  assert.match(worker,/const principal=await verifyNativeOAuth\(request,env,WEB_AUDIENCE\)/);
  assert.doesNotMatch(worker,/verifyIdentityToken\(/);
  assert.match(worker,/verifiedLocOwner\(principal,env\)/);
  assert.doesNotMatch(worker,/LOC_RECOVERY_ROOT_LOC_SUBJECTS/);
  assert.match(worker,/const sub=principal\.subject/);
});

test('LOC credentials remain encrypted in the Authority state',()=>{
  const worker=read('workers/loc-authority/index.mjs');
  assert.match(worker,/encryptProfile\(profile,this\.env\.LOC_CONTROL_ENCRYPTION_KEY\)/);
  assert.match(worker,/decryptProfile\(/);
  assert.match(worker,/databaseTargetsForUser\(subject,isRoot=false\)/);
  assert.match(worker,/this\.ctx\.storage\.list\(\{prefix:'target:'\}\)/);
  assert.doesNotMatch(worker,/targets\.push\(\{id:'loc-main'/);
});

test('signed grants remain scoped, and issuer write authority requires verified LOC owner',()=>{
  const now=Math.floor(Date.now()/1000);
  const claims=issueDelegation({sub:'loc_'+('A'.repeat(40)),
    email:'reader@example.org',grants:['lrunes:manage'],audience:'sql',
    sid:'verified-test',now,seconds:300});
  const result=verifyDelegationBoundary(claims,{kind:'query'});
  assert.equal(canManageDelegation(result.claims,'scope','lrunes'),true);
  assert.equal(canManageDelegation(result.claims,'scope','lo3rwang'),false);
  assert.equal(canManageDelegation(result.claims,'global'),false);
  const worker=read('workers/loc-authority/index.mjs');
  assert.match(worker,/const root=await verifiedLocOwner\(principal,env\)/);
  assert.match(worker,/Only the LOC owner may request writes/);
  assert.match(worker,/if\(!root\|\|input\.scopeid!==undefined/);
});

test('LOC Authority target updates reuse encrypted SQL secrets without browser exposure',async()=>{
  const source=read('workers/loc-authority/index.mjs');
  const start=source.indexOf('function validateTarget(');
  const end=source.indexOf('\nasync function encryptionKey(',start);
  assert.ok(start>0&&end>start);
  const fail=(message,status=400)=>Object.assign(new Error(message),{status});
  const validate=new Function('ID','ENGINES','fail',
    'normalizeSqlDriverAuthentication','sqlAuthNeedsUserPassword',
    source.slice(start,end)+';return validateTarget;')(
      /^[a-z][a-z0-9_-]{0,63}$/,new Set(['postgres','mysql','mssql']),
      fail,normalizeSqlDriverAuthentication,sqlAuthNeedsUserPassword);
  const putStart=source.indexOf('  async putTarget(id,input){');
  const putEnd=source.indexOf('  // Per-user selection is stored',putStart);
  assert.ok(putStart>0&&putEnd>putStart);
  const method=source.slice(putStart,putEnd).trim()
    .replace(/^async putTarget/,'async function putTarget');
  // Mock encryption only to inspect trusted-vs-public storage boundaries.
  // Real Durable Object encryption is independently covered by the Worker.
  const put=new Function('validateTarget','decryptProfile','encryptProfile',
    'fail','publicSqlDriverAuthentication','sqlAuthNeedsUserPassword',
    'sqlTargetRevision',method+';return putTarget;')(
      validate,async x=>x.value,async x=>({value:x}),fail,
      publicSqlDriverAuthentication,sqlAuthNeedsUserPassword,sqlTargetRevision);
  const storage=new Map(),ctx={
    ctx:{storage:{get:async key=>storage.get(key),
      put:async (key,value)=>storage.set(key,value)}},
    env:{LOC_CONTROL_ENCRYPTION_KEY:'test-placeholder'}};
  const target={engine:'mssql',host:'sql.example.net',port:1433,
    database:'loc',username:'',
    authentication:{type:'azure-active-directory-service-principal-secret',
      clientId:'client',tenantId:'tenant',clientSecret:'private-client-secret'}};
  const visible=await put.call(ctx,'azure_test',target);
  assert.equal(JSON.stringify(visible).includes('private-client-secret'),false);
  assert.equal(visible.authentication.client_secret_configured,true);
  assert.equal(JSON.stringify(storage.get('target:azure_test').public)
    .includes('private-client-secret'),false);
  assert.equal(storage.get('target:azure_test').encrypted.value
    .authentication.clientSecret,'private-client-secret');
  const {clientSecret,...redacted}=target.authentication;
  await put.call(ctx,'azure_test',{...target,authentication:redacted});
  assert.equal(storage.get('target:azure_test').encrypted.value
    .authentication.clientSecret,'private-client-secret');
  await assert.rejects(put.call(ctx,'azure_test',{
    ...target,authentication:{type:'azure-active-directory-access-token'}
  }),/access token required/);
  await assert.rejects(put.call(ctx,'new_without_password',{
    engine:'postgres',host:'db.example.net',port:5432,
    database:'loc',username:'user'}),/requires its database password/);
});

test('Worker management permits only the verified single LOC owner identity',async()=>{
 const worker=read('workers/loc-authority/index.mjs');
 const start=worker.indexOf('async function verifiedLocOwner(');
 const end=worker.indexOf('\nfunction b64bytes(',start);
 assert.ok(start>0&&end>start);
 const verifiedLocOwner=new Function(worker.slice(start,end)+
   ';return verifiedLocOwner;')();
 const owner={provider:'loc',emailVerified:true,email:'sopa2306@gmail.com'};
 assert.equal(await verifiedLocOwner(owner,{}),true);
 assert.equal(await verifiedLocOwner({...owner,email:'SOPA2306@GMAIL.COM'},{}),true);
 assert.equal(await verifiedLocOwner({...owner,emailVerified:false},{}),false);
 assert.equal(await verifiedLocOwner({...owner,provider:'github'},{}),false);
 assert.equal(await verifiedLocOwner({...owner,email:'someone@example.org'},{}),false);
 assert.equal(await verifiedLocOwner(null,{}),false);
 assert.match(worker,/if\(!await verifiedLocOwner\(principal,env\)\)throw fail\('LOC owner required',403\)/);
 assert.match(worker,/const principal=await verifyNativeOAuth\(request,env,WEB_AUDIENCE\)/);
 assert.doesNotMatch(worker,/roots\.includes\(principal\.subject\)/);
});


test('LOC registry role lookup preserves trusted lookup stages and never promotes an HTTP failure',async()=>{
  const {locRegistryRoles}=await import('../workers/loc-authority/manage-role.mjs');
  const env={LOC_DB_PROFILE_SERVICE_TOKEN:'test-only-internal-token-at-least-32-characters'};
  const email='owner@example.org';
  const requests=[];
  const good=await locRegistryRoles(env,email,{fetchImpl:async(url,options)=>{
    requests.push({url,options});
    return Response.json({rows:[{id:'lo3rwang',email,role:'admin',active:true},
      {id:'lrunes',email:'other@example.org',role:'admin',active:true},
      {id:'unused',email,role:'admin',active:false}]});
  }});
  assert.deepEqual(good,[{id:'lo3rwang',role:'admin'}]);
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0].url).pathname,'/api/loc-authority-role');
  assert.equal(requests[0].options.headers['x-loc-service-token'],
    env.LOC_DB_PROFILE_SERVICE_TOKEN);
  for(const status of [403,404,503]){
    await assert.rejects(locRegistryRoles(env,email,{fetchImpl:async()=>
      Response.json({error:'LOC registry read unavailable',stage:'driver'},{status})}),
      error=>error.status===503&&error.message.includes('('+status+')'));
  }
  await assert.rejects(locRegistryRoles(env,email,{fetchImpl:async()=>
    Response.json({error:'LOC registry read unavailable',stage:'registry-query',code:'42501'},{status:503})}),
    error=>error.status===503&&error.stage==='registry-query'&&error.code==='42501');
  await assert.rejects(locRegistryRoles(env,email,{fetchImpl:async()=>
    Response.json({unexpected:true})}),error=>error.status===503);
});

test('production registry tracing is in the existing authenticated route, not a public diagnostic API',()=>{
  const route=read('functions/api/loc-authority-role.js');
  const role=read('workers/loc-authority/manage-role.mjs');
  assert.match(route,/let stage='driver',selected=null/);
  assert.match(route,/DATABASE_ACCESS_LIST\.find\(item=>item\.selected===true\)/);
  assert.match(route,/directMcpKysely\(env,primary\.target_id\)/);
  assert.match(route,/stage='registry-query'/);
  assert.match(route,/LOC_DB_PROFILE_SERVICE_TOKEN/);
  assert.ok(route.includes("return respond({error:'LOC registry read unavailable',stage,code,...roleProbe},503)"));
  assert.ok(role.includes('httpStatus:response.status,code,dbRole'));
  assert.doesNotMatch(route,/errorStack|errorCause|url\.searchParams\.get\('token'\)/);
});

test('SQL breaker shares one source across projects on the same server and port',async()=>{
 const first=await sqlSourceKey({host:'DB.EXAMPLE.NET',port:6543});
 const second=await sqlSourceKey({host:'db.example.net',port:6543});
 const otherPort=await sqlSourceKey({host:'db.example.net',port:5432});
 assert.equal(first,second);
 assert.notEqual(first,otherPort);
});

test('one SQL login failure pauses its shared source immediately and retains hourly limit',()=>{
 const now=1_700_000_000_000;
 let start=reserveSqlProbe(null,now,'a');
 assert.equal(start.allowed,true);
 assert.equal(start.state.attempts,1);
 const rejected=finishSqlProbe(start.state,'a',
  {ok:false,reason:'AUTH_FAILED'},now+100);
 assert.equal(rejected.accepted,true);
 assert.equal(rejected.reason,'AUTH_FAILED');
 assert.equal(rejected.state.last_update,now+100);
 assert.equal(rejected.state.blockedUntil,now+100+SQL_PROBE_COOLDOWN_MS);
 assert.equal(rejected.state.generation,1);
 const paused=reserveSqlProbe(rejected.state,now+101,'b');
 assert.equal(paused.allowed,false);
 assert.equal(paused.reason,'SOURCE_PAUSED');
 assert.equal(paused.retryAt,rejected.state.blockedUntil);
 let afterCooldown=reserveSqlProbe(rejected.state,
  now+100+SQL_PROBE_COOLDOWN_MS,'b');
 assert.equal(afterCooldown.allowed,true);
 assert.equal(afterCooldown.state.attempts,2);
 let succeeded=finishSqlProbe(afterCooldown.state,'b',
  {ok:true,typeVerified:true,credentialsVerified:true},
  now+101+SQL_PROBE_COOLDOWN_MS);
 assert.equal(succeeded.success,true);
 const third=reserveSqlProbe(succeeded.state,now+102+SQL_PROBE_COOLDOWN_MS,'c');
 assert.equal(third.allowed,true);
 succeeded=finishSqlProbe(third.state,'c',
  {ok:true,typeVerified:true,credentialsVerified:true},
  now+103+SQL_PROBE_COOLDOWN_MS);
 assert.equal(succeeded.success,true);
 const blocked=reserveSqlProbe(succeeded.state,now+104+SQL_PROBE_COOLDOWN_MS,'d');
 assert.equal(blocked.allowed,false);
 assert.equal(blocked.reason,'PROBE_LIMIT');
 assert.equal(blocked.retryAt,now+SQL_PROBE_WINDOW_MS);
});

test('expired SQL probe lease never grants an automatic retry',()=>{
 const now=1_700_000_000_000;
 const start=reserveSqlProbe(null,now,'ticket');
 const expired=reserveSqlProbe(start.state,now+30_001,'new-ticket');
 assert.equal(expired.allowed,false);
 assert.equal(expired.reason,'SOURCE_PAUSED');
 assert.equal(expired.state.last_update,now+30_001);
 assert.equal(expired.state.generation,1);
 assert.equal(expired.save,true);
});

test('SQL execution requires matched verification revision and breaker generation',()=>{
 const now=1_700_000_000_000;
 const source={blockedUntil:0,generation:2,inFlight:null};
 const target={status:'verified',revision:'rev',generation:2};
 assert.equal(sqlVerificationAllowed(source,target,'rev',now),true);
 assert.equal(sqlVerificationAllowed({...source,blockedUntil:now+300000},
  target,'rev',now),false);
 assert.equal(sqlVerificationAllowed({...source,inFlight:'another-probe'},
  target,'rev',now),false);
 assert.equal(sqlVerificationAllowed({...source,generation:3},
  target,'rev',now),false);
 assert.equal(sqlVerificationAllowed(source,target,'changed',now),false);
 assert.equal(sqlVerificationAllowed(source,{...target,status:'unverified'},
  'rev',now),false);
});
