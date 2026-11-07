// LOC Pages fixed-purpose Keyword API. No generic SQL Gateway and no
// database credentials are sent to browsers. Every private request carries
// a cryptographically verified LOC Auth Scope delegation.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {bindLocAuthorization,canManageLoc} from '../../app/loc/providers/loc-authorization.mjs';
import {verifyDelegationBoundary} from '../../app/loc/auth/delegation-contract.mjs';
import {
  readKeywordClasses,readKeywordStatistics,readKeywordCatalog,readKeywordDaily,
  suggestKeywordPatterns,analyzeKeywordScope
} from '../../app/loc/keyword-sql-service.mjs';

const ISSUER='https://auth.lo3rwang.cc';
const JWKS=ISSUER+'/.well-known/jwks.json';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const OPERATIONS=new Set(['analyze','classes','catalog','summary','stats','suggest']);
let keys=null,expires=0,loading=null;

function respond(data,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'}
  });
}
const error=(message,status=400)=>{
  const e=new Error(message);e.httpStatus=status;throw e;
};
function decode(value){
  if(!/^[A-Za-z0-9_-]+$/.test(String(value||'')))error('Invalid LOC token encoding',401);
  const s=atob(value.replace(/-/g,'+').replace(/_/g,'/')
    .padEnd(Math.ceil(value.length/4)*4,'='));
  return Uint8Array.from(s,character=>character.charCodeAt(0));
}
function jsonSegment(text){
  try{return JSON.parse(new TextDecoder().decode(decode(text)));}
  catch{error('Malformed LOC token',401);}
}
async function signingKeys(){
  if(keys&&Date.now()<expires)return keys;
  if(loading)return loading;
  loading=(async()=>{
    const response=await fetch(JWKS,{
      headers:{accept:'application/json'},signal:AbortSignal.timeout(6000)});
    if(!response.ok)error('LOC public signing keys unavailable',503);
    const content=await response.text();
    if(content.length>120000)error('Invalid LOC signing-key response',503);
    const payload=JSON.parse(content);
    if(!Array.isArray(payload.keys))error('LOC signing keys invalid',503);
    keys=payload.keys;
    expires=Date.now()+300000;
    return keys;
  })();
  try{return await loading;}finally{loading=null;}
}
async function verifiedIdentity(request){
  const bearer=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
  if(!bearer)return {role:'anon',claims:{}};
  const parts=bearer[1].split('.');
  if(parts.length!==3)error('LOC signed delegation required',401);
  const header=jsonSegment(parts[0]),payload=jsonSegment(parts[1]);
  if(header?.alg!=='RS256'||typeof header.kid!=='string'||
     payload?.iss!=='loc'||payload?.aud!=='loc-delegation')
    error('Invalid LOC delegation issuer or audience',401);
  const candidates=await signingKeys();
  const jwk=candidates.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
    (!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!jwk)error('Unknown LOC signing key',401);
  let verified=false;
  try{
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
      decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{}
  if(!verified)error('LOC delegation signature invalid',401);
  try{
    const result=verifyDelegationBoundary(payload,{
      kind:'managed-action',name:'keyword_pattern_statistics'});
    return {role:'authenticated',claims:result.claims};
  }catch{error('LOC delegation expired or invalid',401);}
}
async function permission(db,role,claims,scope){
  return db.transaction().execute(async trx=>{
    bindLocAuthorization(trx,{role,claims});
    return canManageLoc(trx,'scope',scope);
  });
}

export async function onRequestPost(context){
  try{
    const request=context.request;
    if(Number(request.headers.get('content-length')||0)>16000)
      error('Keyword request too large',413);
    const raw=await request.text();
    if(raw.length>16000)error('Keyword request too large',413);
    let input;
    try{input=JSON.parse(raw);}catch{error('Invalid Keyword request JSON');}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       !OPERATIONS.has(input.operation)||!input.args||
       typeof input.args!=='object'||Array.isArray(input.args))
      error('Unknown Keyword operation');
    const {operation,args}=input;
    const {role,claims}=await verifiedIdentity(request);
    const scope=String(args.scopeId||'');
    if(operation!=='suggest'&&!SCOPE.test(scope))
      error('Invalid Keyword Scope');
    if(['catalog','stats','summary','analyze'].includes(operation)&&
       !UID.test(String(args.classUid||'')))
      error('Invalid Keyword Class');
    // The existing Pages native Kysely connection is server-selected; never
    // accept a target URL, SQL dialect or credential from HTTP arguments.
    const entry=directMcpKysely(context.env);
    const db=entry.db;
    let result;
    if(operation==='suggest'){
      const scopes=args.scopeIds;
      if(!Array.isArray(scopes)||scopes.some(id=>!SCOPE.test(id)))
        error('Invalid Keyword Scope list');
      const owned=new Set();
      for(const id of new Set(scopes))
        if(await permission(db,role,claims,id))owned.add(id);
      result=await suggestKeywordPatterns(db,scopes,String(args.query||''),{
        ownerScopes:owned
      });
    }else{
      const owner=await permission(db,role,claims,scope);
      if(operation==='analyze'){
        if(!owner)error('Scope Keyword management permission required',403);
        result=await analyzeKeywordScope(db,scope,args.classUid,{
          authorizeTransaction:async trx=>{
            bindLocAuthorization(trx,{role,claims});
            if(!await canManageLoc(trx,'scope',scope))
              error('Scope Keyword authorization expired',403);
          }
        });
      }else if(operation==='classes'){
        result=await readKeywordClasses(db,scope,{owner});
      }else if(operation==='catalog'){
        result=await readKeywordCatalog(db,scope,args.classUid,{owner});
      }else{
        const opt={owner,start:String(args.startDate||''),
          end:String(args.endDate||''),source:String(args.source||'')};
        result=operation==='stats'
          ?await readKeywordStatistics(db,scope,args.classUid,opt)
          :await readKeywordDaily(db,scope,args.classUid,opt);
      }
    }
    return respond({data:result});
  }catch(e){
    const status=Number.isInteger(e?.httpStatus)?e.httpStatus:
      Number.isInteger(e?.status)?e.status:503;
    return respond({error:status<500?String(e?.message||'Keyword request rejected'):
      '關鍵詞資料來源目前無法處理此請求'},status);
  }
}
export function onRequestGet(){return respond({error:'POST required'},405);}
export function onRequestOptions(){return respond({error:'POST required'},405);}
