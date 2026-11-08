import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const route=source('functions/api/source-catalog.js');
const editor=source('app/loc/FlatClassificationEditor.jsx');
const shared=source('app/loc/source-sql-service.mjs');
const client=source('app/loc/source-catalog-client.mjs');
const readHook=source('app/loc/scope-source-category-row.mjs');
const verifier=source('functions/_loc-delegation.mjs');

const validateRegion=route.slice(route.indexOf('function validate(input){'),
  route.indexOf('export async function onRequestPost('));
const validate=new Function('SCOPE','UID','OPERATIONS','reject',
  validateRegion+'return validate;')(
    /^[a-z][a-z0-9]{0,14}$/,
    /^[A-Za-z0-9]{8}$/,
    new Set(['read','save_scope','save_system']),
    (message,status=400)=>{throw Object.assign(new Error(message),{httpStatus:status});}
  );

test('LOC system field uses only existing DefaultArticleClass writer',()=>{
  const request=validate({operation:'save_system',scopeId:'loc',
    names:['Facebook','Threads','Instagram']});
  assert.deepEqual(request,{name:'update_group_default_article_class',
    args:{p_group_id:'loc',p_names:['Facebook','Threads','Instagram']}});
  assert.throws(()=>validate({operation:'save_system',scopeId:'lo3rwang',names:['fb']}),/Invalid LOC/);
  assert.throws(()=>validate({operation:'save_system',scopeId:'loc',names:['a','a']}),/Invalid LOC/);
  assert.match(shared,/export async function saveLocSystemSources/);
  assert.match(shared,/canManageLoc\(trx,'group','loc'\)/);
  assert.match(shared,/forUpdate\(\)/);
  assert.match(shared,/DefaultArticleClass/);
});

test('Scope full-field write carries immutable physical From UIDs and labels',()=>{
  const rows=[{uid:'47dc42c2',name:'kkcity',label:'kkcity'},
    {uid:'8c55398d',name:'vocus',label:'方格子vocus'},
    {name:'newsource',label:'新來源'}];
  const result=validate({operation:'save_scope',scopeId:'lo3rwang',sources:rows});
  assert.equal(result.name,'save_scope_sources');
  assert.deepEqual(result.args.p_sources,rows);
  assert.throws(()=>validate({operation:'save_scope',scopeId:'loc',sources:rows}),/Invalid Scope/);
  assert.throws(()=>validate({operation:'save_scope',scopeId:'lo3rwang',
    sources:[{uid:'wrong',name:'fb'}]}),/Invalid Scope From/);
  assert.throws(()=>validate({operation:'save_scope',scopeId:'lo3rwang',
    sources:[{name:'FB'},{name:'fb'}]}),/Duplicate Scope From/);
  assert.throws(()=>validate({operation:'read',scopeId:'lo3rwang',
    names:['x']}),/Unexpected Source/);
  assert.throws(()=>validate({operation:'read',scopeId:'lo3rwang',
    table:'silver.loc'}),/Invalid Source/);
  assert.match(shared,/Source site key is immutable/);
  assert.match(shared,/sourceGraph.childrenOf\(domain.uid\)/);
  assert.match(shared,/sourceTreeFromCatalog/);
});

test('Editor and other management views use native Source transport, not unsupported managedAction',()=>{
  assert.match(editor,/sourceCatalogService\('read',scopeId\)/);
  assert.match(editor,/sourceCatalogService\(/);
  assert.match(readHook,/sourceCatalogService\('read',id\)/);
  assert.doesNotMatch(editor,/\.managedAction\(/);
  assert.doesNotMatch(readHook,/\.managedAction\(/);
  assert.match(editor,/await Promise\.all\(\[query\.refetch\(\),/);
  assert.match(editor,/源；Galaxy\.site 不變/);
});

test('Native source API verifies signed LOC Authority claims and never reads user-supplied SQL',()=>{
  assert.match(route,/verifiedIdentity\(request,context\.env\)/);
  assert.match(route,/bindLocAuthorization\(trx,\{role,claims\}\)/);
  assert.match(route,/sourceCatalogAction\(trx,operation\.args/);
  assert.match(route,/saveLocSystemSources\(trx,operation\.args\)/);
  assert.match(route,/if\(role!=='authenticated'\)/);
  assert.doesNotMatch(route,/request\.headers\.get\('x-role'\)|eval\(|\.raw\(/);
  assert.match(verifier,/crypto\.subtle\.verify\('RSASSA-PKCS1-v1_5'/);
  assert.match(verifier,/LOC_DELEGATION_REVOKED_SIDS/);
  assert.match(verifier,/verifyDelegationBoundary/);
  assert.match(route,/directMcpKysely\(context\.env\)/);
});

test('Service calls native same-origin endpoint with self-delegation',async()=>{
  let sent=null;
  const region=client.slice(client.indexOf('export async function sourceCatalogService('));
  const run=new Function('locDelegation','fetch','AbortSignal','SCOPE',
    region.replace('export async function','async function')+'return sourceCatalogService;')(
      async()=> 'header.payload.signature',
      async(url,opts)=>{sent={url,opts};return {ok:true,
        json:async()=>({data:{saved:true}})};},
      {timeout:()=>undefined},/^[a-z][a-z0-9]{0,14}$/
    );
  const done=await run('save_scope','lo3rwang',
    [{uid:'47dc42c2',name:'kkcity',label:'kkcity'}]);
  assert.equal(done.saved,true);
  assert.equal(sent.url,'/api/source-catalog');
  assert.equal(sent.opts.method,'POST');
  assert.match(sent.opts.headers.authorization,/^Bearer header\.payload\.signature$/);
  assert.deepEqual(JSON.parse(sent.opts.body),{operation:'save_scope',scopeId:'lo3rwang',
    sources:[{uid:'47dc42c2',name:'kkcity',label:'kkcity'}]});
});

test('Source service is Pages compatible and no business SQL action is duplicated',()=>{
  assert.match(shared,/import \{sql\} from 'kysely'/);
  assert.doesNotMatch(shared,/npm:kysely|createTable|CREATE TABLE|JOIN /i);
  const manager=source('app/loc/providers/kysely-management.mjs');
  assert.match(manager,/import \{sourceCatalogAction,saveLocSystemSources\}/);
  assert.equal(manager.includes('async function sourceCatalogAction('),false);
  assert.match(manager,/name==='save_scope_sources'/);
  assert.match(manager,/await saveLocSystemSources\(trx,args\)/);
});
