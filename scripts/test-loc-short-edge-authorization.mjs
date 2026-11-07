import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeDelegatedShortImport} from '../app/loc/import/short-edge-authorization.mjs';

const batch={id:'10000000-0000-4000-8000-000000000030',write_mode:'append',
 records:[{id:'10000000-0000-4000-8000-000000000001',
 group_id:'10000000-0000-4000-8000-000000000011',
 source_key:'https://example.org/a',url:'https://example.org/a',
 title:'文章 A',content:'原文',captured_at:'2026-11-07T01:00:00Z',
 kind:'capture',write_mode:'append',part_index:0,part_count:1}]};
const request={kind:'short-import',scopeid:'lo3rwang',batch};
const claims={provider:'loc',me:true,sub:'loc_user_verified',
 grants:['lo3rwang:write']};
const status=error=>Number(error?.httpStatus);

test('only signed LOC Scope write delegation authorizes short import',()=>{
 const actor=authorizeDelegatedShortImport(request,claims);
 assert.deepEqual(actor,{authorized:true,scopeid:'lo3rwang',subject:'loc_user_verified'});
 assert.equal(authorizeDelegatedShortImport({...request,scopeid:'lrunes'},
  {...claims,grants:['lrunes:write']}).scopeid,'lrunes');
});
test('ordinary authentication, global manage and other Scope grants do not imply write',()=>{
 for(const grant of [[],['lo3rwang:read'],['lo3rwang:manage'],['lrunes:write'],['global:manage']])
  assert.throws(()=>authorizeDelegatedShortImport(request,{...claims,grants:grant}),
   error=>status(error)===403);
 for(const invalid of [{...claims,provider:'clerk'},{...claims,me:false},
  {...claims,sub:''},{...claims,grants:null},null])
  assert.throws(()=>authorizeDelegatedShortImport(request,invalid),
   error=>status(error)===403);
});
test('caller cannot override user, Scope, database target or SQL request shape',()=>{
 for(const tampered of [{...request,actor:claims},{...request,subject:'other'},
  {...request,target:'supabase'},{...request,operation:'update'},
  {...request,scopeid:'another'},{...request,scopeid:'LOC'},
  {...request,kind:'query'},{...request,batch:null}])
  assert.throws(()=>authorizeDelegatedShortImport(tampered,claims),
   error=>status(error)===400);
});
test('Edge mounts short-import only after verifying LOC SQL delegation',()=>{
 const edge=readFileSync(new URL('../app/loc/gateway/sql-handler.ts',import.meta.url),'utf8');
 const auth=edge.indexOf('const delegation=await verifyLocDelegation(match[1],body)');
 const gate=edge.indexOf('const actor=authorizeDelegatedShortImport(body,claims)');
 const db=edge.indexOf('const db=await databaseForTarget(controlTarget);',gate);
 assert.ok(auth>=0&&gate>auth&&db>gate,
  'credential and Scope grant checks must happen before database access');
 assert.ok(edge.includes('store:postgresShortImportStore(db,sql)'));
 assert.ok(edge.includes('if(requestedTarget!=="configured")'));
});
