import { DurableObject } from 'cloudflare:workers';
import {checkExternalAuthQos} from './auth-qos.mjs';
import {issueDelegation} from '../../app/loc/auth/delegation-contract.mjs';
import {locRegistryRoles,isLocRegistryAdmin} from './manage-role.mjs';
import {normalizeSqlDriverAuthentication,publicSqlDriverAuthentication,
  sqlAuthNeedsUserPassword} from '../../app/loc/providers/sql-driver-auth.mjs';
import {ISSUER,MCP_AUDIENCE,WEB_AUDIENCE,isNativeOAuthPath,handleNativeOAuth,
  verifyNativeOAuth} from './native-oauth.mjs';
import {runBetterAuthStore} from './better-auth-store.mjs';
import {handleFirstPartyAuth} from './better-auth-native.mjs';
import {verifyAuthReference,assertReferencePermission} from './auth-ref.mjs';
import {validateKeywordCategoryEntry,hashKeywordCategory,assertPublicKeywordClass} from './keyword-categories.mjs';
import {AUTH_PROVIDER_TYPES,validateAuthProviderSettings,publicAuthProviderSettings}
  from '../../app/loc/auth/auth-provider-settings.mjs';
// LOC Auth is the native identity issuer and the owner of signed SQL delegations.
// This Worker has no dependency on a third-party identity session.
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const ENGINES=new Set(['postgres','mysql','mssql']);
function fail(message,status=400){return Object.assign(new Error(message),{status});}
async function verifiedLocOwner(principal,env){
  return principal?.provider==='loc'&&principal.emailVerified===true&&
    isLocRegistryAdmin(await locRegistryRoles(env,principal.email));
}
function b64bytes(value){
  const value64=String(value).replace(/-/g,'+').replace(/_/g,'/');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value64))throw fail('Invalid encoding',401);
  const raw=atob(value64.padEnd(Math.ceil(value64.length/4)*4,'='));
  return Uint8Array.from(raw,character=>character.charCodeAt(0));
}
function fromBytes(bytes){return btoa(String.fromCharCode(...bytes));}
function json(data,status=200,origin=''){
  return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...(origin?{'access-control-allow-origin':origin,'vary':'origin'}:{})}});
}
function allowedOrigin(request,env){
  const origin=request.headers.get('origin')||'';
  const configured=String(env.LOC_CONTROL_ORIGIN||'').replace(/\/$/,'');
  if(!/^https:\/\/[^/]+$/.test(configured))throw fail('Control origin is not configured',503);
  if(origin&&origin!==configured)throw fail('Origin not allowed',403);
  return origin;
}
function requireSetup(env){
  if(!env.LOC_CONTROL_ORIGIN||!env.LOC_CONTROL_ENCRYPTION_KEY||
     !env.LOC_AUTHORITY_STATE)
    throw fail('LOC Auth control is not configured',503);
}
function validateTarget(input,id){
  if(!ID.test(id)||!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid target');
  const engine=String(input.engine||'');
  const host=String(input.host||'').trim().toLowerCase();
  const database=String(input.database||'').trim();
  const username=String(input.username||'').trim();
  let authentication;
  try{authentication=normalizeSqlDriverAuthentication(engine,input.authentication);}
  catch(error){throw fail(error.message||'Invalid SQL driver authentication',400)}
  const label=String(input.label||id).trim();
  const port=Number(input.port);
  if(!ENGINES.has(engine)||!/^[a-z0-9.-]{1,253}$/.test(host)||host.startsWith('.')||host.endsWith('.')||
    !Number.isInteger(port)||port<1||port>65535||
    !/^[a-zA-Z0-9_\-]{1,120}$/.test(database)||
    (sqlAuthNeedsUserPassword(authentication)&&!username)||username.length>120||
    !label||label.length>120)
    throw fail('Invalid database connection metadata');
  const password=input.password;
  if(password!==undefined&&(typeof password!=='string'||password.length>4096))throw fail('Invalid database secret');
  const refProvider=String(input.ref_provider||'');
  const refPermission=String(input.ref_permission||'');
  if(refProvider&&!AUTH_PROVIDER_TYPES.includes(refProvider)||
     refPermission&&(!refProvider||!/^[A-Za-z0-9_:@.\/\-]{2,256}$/.test(refPermission)))
    throw fail('Invalid database Auth Ref requirement',400);
  const schemaName=String(input.schema_name||
    (engine==='postgres'?'silver':engine==='mssql'?'dbo':''));
  const tableName=String(input.table_name||'');
  const columns=input.field_map||{};
  const identifier=/^[A-Za-z][A-Za-z0-9_]{0,119}$/;
  if((schemaName&&!identifier.test(schemaName))||
     (tableName&&!identifier.test(tableName))||
     !columns||typeof columns!=='object'||Array.isArray(columns)||
     Object.keys(columns).length>32||
     Object.entries(columns).some(([logical,physical])=>
       !identifier.test(logical)||typeof physical!=='string'||
       !identifier.test(physical)))
    throw fail('Invalid database relation mapping',400);
  const selectableByUsers=input.selectable_by_users===true;
 if(input.selectable_by_users!==undefined&&typeof input.selectable_by_users!=='boolean')
  throw fail('Invalid user database selection policy');
 const allowedSubjects=input.allowed_subjects||[];
 if(!Array.isArray(allowedSubjects)||allowedSubjects.length>500||
    allowedSubjects.some(x=>!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(x))))
   throw fail('Invalid database allowed subjects');
 return {id,engine,host,port,database,username,label,authentication,
  ref_provider:refProvider,ref_permission:refPermission,
  schema_name:schemaName,table_name:tableName,field_map:columns,
  selectable_by_users:selectableByUsers,
  allowed_subjects:[...new Set(allowedSubjects)],
  ...(password?{password}:{})};
}
async function encryptionKey(secret){
  const bytes=b64bytes(secret);
  if(bytes.length!==32)throw fail('Control encryption key must be 32 bytes',503);
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptProfile(profile,secret){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await encryptionKey(secret);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(profile)));
  return fromBytes(iv)+'.'+fromBytes(new Uint8Array(cipher));
}
async function decryptProfile(value,secret){
  const parts=String(value).split('.');
  if(parts.length!==2)throw fail('Invalid saved target',503);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64bytes(parts[0])},await encryptionKey(secret),b64bytes(parts[1]));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// MCP OAuth uses a signed, audience-bound LOC access token.
// Data access is separately authorized by this Group Authority's grants.
const MCP_RESOURCE='https://mcp.lo3rwang.cc';
const MANAGED_SCOPE_TABLES=Object.freeze({lo3rwang:'lo3rwang_galaxy',lrunes:'lrunes_galaxy'});
// OAuth grants are minted here; the existing LOC application backend opens its
// own direct Kysely connection. This is a fixed Galaxy business operation,
// not a generic SQL transport or a user-configurable destination.
const LOC_NATIVE_APPLICATION='https://mcp.lo3rwang.cc/api/loc-native';
async function mcpNativeRequest(env,kind,scopeid,fields,locDelegation){
  if(typeof locDelegation!=='string'||locDelegation.split('.').length!==3)
    throw fail('LOC MCP delegation required',401);
  const response=await fetch(LOC_NATIVE_APPLICATION,{
    method:'POST',headers:{authorization:'Bearer '+locDelegation,
      'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({kind,scopeid,...fields}),
    signal:AbortSignal.timeout(25000),redirect:'error',cache:'no-store'
  });
  if(!response.ok){
    let reason='LOC native application operation rejected';
    if(response.status>=400&&response.status<500){
      const data=await response.json().catch(()=>null);
      reason=String(data?.error?.message||data?.error||reason).slice(0,200);
    }
    throw fail(reason,[400,401,403,404,409,413].includes(response.status)?
      response.status:502);
  }
  const result=await response.json();
  if(!result||!Object.hasOwn(result,'data'))
    throw fail('Invalid LOC native application response',502);
  return result.data;
}
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const TABLE_ID=/^[a-z][a-z0-9_]{0,62}$/;
const UID=/^[A-Za-z0-9]{8}$/;
function validScope(value){if(!SCOPE_ID.test(String(value||'')))throw fail('Invalid Scope',400);return value;}
function validTimestamp(value){
  const stamp=Date.parse(String(value||''));
  if(!Number.isFinite(stamp)||!/^\d{4}-\d\d-\d\dT/.test(String(value)))throw fail('Invalid source update time',400);
  return new Date(stamp).toISOString();
}
async function mcpJsonBody(request,limit=160000){
  const raw=await request.text();
  if(raw.length>limit)throw fail('MCP payload too large',413);
  try{return JSON.parse(raw)}catch{throw fail('Invalid MCP JSON',400)}
}
const BASE62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newUid(){let uid='';while(uid.length<8){
  for(const b of crypto.getRandomValues(new Uint8Array(16)))
    if(b<248&&uid.length<8)uid+=BASE62[b%62];
 }return uid;}
function likePattern(value){
  if(typeof value!=='string'||value.trim().length<2||value.length>100||
    /[\u0000-\u001f\u007f]/.test(value))throw fail('Query must contain 2–100 characters',400);
  return '"*'+value.trim().replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[%_*]/g,'\\$&')+'*"';
}
async function managedMcpInsert(scopeid,row,updateExisting,token,env){
  const data=await mcpNativeRequest(env,'mcp-sync',scopeid,
    {row,update_existing:updateExisting},token);
  if(data?.count!==1)throw fail('MCP insert was not confirmed',502);
}
// Append is separate from full sync: existing Galaxy metadata must never be overwritten.
async function managedMcpAppend(scopeid,uid,content,batchId,updatedAt,token,env){
  const data=await mcpNativeRequest(env,'mcp-append',scopeid,
    {uid,content,batch_id:batchId,updated_at:updatedAt},token);
  if(data?.count!==1)throw fail('MCP append was not confirmed',502);
  return data;
}
async function managedMcpRead(scopeid,kind,args,token,env){
  const rows=await mcpNativeRequest(env,kind,scopeid,args,token);
  if(!Array.isArray(rows))throw fail('Invalid MCP Kysely read results',502);
  return rows;
}
export class LocAuthorityState extends DurableObject {
  constructor(ctx,env){super(ctx,env);}
  async authQuotaAcquire(kind, fingerprint, limit){
    // All callers in a bucket are serialized by its Durable Object.
    if (!/^[a-z]{3,20}$/.test(String(kind)) ||
        !/^[0-9a-f]{64}$/.test(String(fingerprint)) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw fail('Invalid LOC Auth quota request', 400);
    const now = Date.now(), minute = 60_000;
    const key = 'auth-qos:' + kind + ':' + fingerprint;
    return this.ctx.storage.transaction(async tx => {
      const saved = await tx.get(key) || {};
      if (Number(saved.blockedUntil || 0) > now)
        return {allowed:false, retryAfter:Math.ceil((saved.blockedUntil-now)/1000)};
      const inWindow = Number(saved.start || 0) <= now &&
        now - Number(saved.start || 0) < minute;
      const next = {
        start:inWindow ? saved.start : now,
        count:(inWindow ? Number(saved.count || 0) : 0) + 1,
        rejects:inWindow ? Number(saved.rejects || 0) : 0,
        strikes:Number(saved.lastStrikeAt || 0) > now-86_400_000 ?
          Number(saved.strikes || 0) : 0,
        lastStrikeAt:Number(saved.lastStrikeAt || 0),
        blockedUntil:0
      };
      if (next.count <= limit) {
        await tx.put(key, next);
        return {allowed:true};
      }
      next.rejects += 1;
      if (next.rejects >= 3) {
        next.strikes = Math.min(6, next.strikes + 1);
        next.lastStrikeAt = now;
        next.blockedUntil = now +
          Math.min(3_600_000, 180_000 * 2 ** (next.strikes - 1));
      }
      await tx.put(key, next);
      return {allowed:false, retryAfter:Math.ceil(
        ((next.blockedUntil > now ? next.blockedUntil : next.start + minute)-now)/1000)};
    });
  }
  async betterAuthStorage(request){return runBetterAuthStore(this.ctx.storage,request);}
  async nativeBindGoogleOwner(subject,googleAccountId,email){
    if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||''))||
       !googleAccountId||!email)throw fail('Invalid LOC owner identity binding',400);
    return this.ctx.storage.transaction(async t=>{
      const key='native-google-owner:'+subject;
      const current=await t.get(key);
      if(current&&(current.googleAccountId!==googleAccountId||
                    current.email!==email))
        throw fail('LOC owner Google account already bound',403);
      if(!current)await t.put(key,{googleAccountId,email});
      return true;
    });
  }
  async nativeGet(key){return this.ctx.storage.get(key);}
  async nativePut(key,value){await this.ctx.storage.put(key,value);return true;}
  async nativeTake(key){return this.ctx.storage.transaction(async t=>{
    const value=await t.get(key);if(value!==undefined)await t.delete(key);return value;
  });}
  async authRefProfile(type){
    if(!AUTH_PROVIDER_TYPES.includes(type))throw fail('Unknown Auth Ref',400);
    const item=await this.ctx.storage.get('auth-provider:'+type);
    if(!item)throw fail('Auth Ref is not configured',503);
    return decryptProfile(item.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY);
  }
  async recordAuthReference(subject,assertion){
    if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||''))||
       !AUTH_PROVIDER_TYPES.includes(assertion?.provider)||
       !Number.isFinite(assertion?.expires)||assertion.expires<=Date.now())
      throw fail('Invalid Auth Ref assertion',400);
    await this.ctx.storage.put('auth-ref:'+subject+':'+assertion.provider,assertion);
    return {provider:assertion.provider,externalSubject:assertion.externalSubject,
      permissions:assertion.permissions,expires:assertion.expires};
  }
  async authReferenceStatus(subject){
    const rows=await this.ctx.storage.list({prefix:'auth-ref:'+subject+':'});
    return [...rows.values()].filter(x=>x.expires>Date.now()).map(x=>
      ({provider:x.provider,externalSubject:x.externalSubject,
        permissions:x.permissions,expires:x.expires}));
  }
  async checkAuthReference(subject,provider,permission=''){
    const assertion=await this.ctx.storage.get('auth-ref:'+subject+':'+provider);
    assertReferencePermission(assertion,provider,permission);
    return true;
  }
  async hasVerifiedAuthRefEmail(subject,email){
    const proofs=await this.ctx.storage.list({prefix:'auth-ref:'+subject+':'});
    return [...proofs.values()].some(x=>x.emailVerified===true&&
      x.expires>Date.now()&&x.email===String(email||'').trim().toLowerCase());
  }
  async nativeProvider(type){
    if(!['github','oidc'].includes(type))throw fail('Unsupported identity provider');
    const item=await this.ctx.storage.get('auth-provider:'+type);
    return item?decryptProfile(item.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
  }
  async listState(){
    const saved=await this.ctx.storage.list({prefix:'target:'});
    const targets=[];
    for(const [key,item] of saved)targets.push({id:key.slice(7),...item.public});
    // The default control alias is not a selectable user credential.
    if(!targets.some(target=>target.id==='loc-main'))targets.push({
      id:'loc-main',label:'主要資料庫連線',engine:'postgres',managed:true
    });
    targets.sort((a,b)=>a.id.localeCompare(b.id));
    const savedPrimary=await this.ctx.storage.get('primary_id');
    const primary=targets.some(target=>target.id===savedPrimary)
      ?savedPrimary:'loc-main';
    return {primary_id:primary,targets};
  }
  // LOC delegates access with a self-managed asymmetric key. The private JWK
  // remains AES-GCM encrypted in this existing Authority Durable Object.
  // The LOC application backend verifies the public JWKS; no shared bearer secret.
  async delegationKeyRecord(){
    const name='loc-auth:delegation-rs256:v1';
    const existing=await this.ctx.storage.get(name);
    if(existing)return existing;
    return this.ctx.blockConcurrencyWhile(async()=>{
      const current=await this.ctx.storage.get(name);
      if(current)return current;
      const keys=await crypto.subtle.generateKey({
        name:'RSASSA-PKCS1-v1_5',modulusLength:3072,
        publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
      },true,['sign','verify']);
      const exported=await Promise.all([
        crypto.subtle.exportKey('jwk',keys.privateKey),
        crypto.subtle.exportKey('jwk',keys.publicKey)
      ]);
      const thumb=await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(exported[1].n+'.'+exported[1].e));
      const kid='loc-'+Array.from(new Uint8Array(thumb)).slice(0,12)
        .map(b=>b.toString(16).padStart(2,'0')).join('');
      const item={kid,
        public:{kty:'RSA',n:exported[1].n,e:exported[1].e,
          kid,alg:'RS256',use:'sig'},
        encrypted:await encryptProfile({privateJwk:exported[0]},
          this.env.LOC_CONTROL_ENCRYPTION_KEY)};
      await this.ctx.storage.put(name,item);
      return item;
    });
  }
  async delegationJwks(){
    const record=await this.delegationKeyRecord();
    return {keys:[record.public]};
  }
  async signLocDelegation(claims){
    // Called only after the Worker authenticates the caller and checks Scope
    // grants. No endpoint returns the private signing key.
    const record=await this.delegationKeyRecord();
    const {privateJwk}=await decryptProfile(record.encrypted,
      this.env.LOC_CONTROL_ENCRYPTION_KEY);
    const key=await crypto.subtle.importKey('jwk',privateJwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const encode=value=>fromBytes(new TextEncoder().encode(JSON.stringify(value)))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const input=encode({alg:'RS256',typ:'JWT',kid:record.kid})+'.'+encode(claims);
    const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,
      new TextEncoder().encode(input));
    return input+'.'+fromBytes(new Uint8Array(sig))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  // Root-only Auth connections. Store full credentials encrypted in the
  // existing Durable Object; GET returns metadata, never plaintext secrets.
  async listAuthProviders(){
    const providers=[];
    for(const type of AUTH_PROVIDER_TYPES){
      const item=await this.ctx.storage.get('auth-provider:'+type);
      providers.push(item?{...item.public,active:false,runtime_connected:false}:
        {type,configured:false,secret_configured:false,active:false,runtime_connected:false});
    }
    // LOC Auth session verification is independent of OAuth provider settings.
    // This value is intentionally not writable through these endpoints.
    return {active:'loc',providers};
  }
  async putAuthProvider(type,values){
    const previous=await this.ctx.storage.get('auth-provider:'+type);
    const former=previous
      ?await decryptProfile(previous.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
    let profile;
    try{
      profile=validateAuthProviderSettings(type,values,
        {previous:former,siteOrigin:ISSUER});
    }catch(error){throw fail(error.message||'Invalid auth provider settings',400)}
    const publicView=publicAuthProviderSettings(profile);
    await this.ctx.storage.put('auth-provider:'+type,{
      public:publicView,
      encrypted:await encryptProfile(profile,this.env.LOC_CONTROL_ENCRYPTION_KEY)
    });
    return publicView;
  }
  async trustedDatabaseProfile(id){
    if(!ID.test(String(id||'')))throw fail('Invalid database target',400);
    const saved=await this.ctx.storage.get('target:'+id);
    if(!saved)throw fail('Database target not configured',404);
    return decryptProfile(saved.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY);
  }
  async putTarget(id,input){
    const old=await this.ctx.storage.get('target:'+id);
    const previous=old?await decryptProfile(old.encrypted,
      this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
    // Only reuse encrypted secrets for the same authentication mode. An
    // unchanged Admin form never needs to receive or re-submit a secret.
    const incoming=input?.authentication;
    const selectedType=String(incoming?.type||
      previous?.authentication?.type||'default');
    const priorAuth=previous?.authentication?.type===selectedType
      ?previous.authentication:{};
    const authentication=incoming===undefined
      ?previous?.authentication
      :{...priorAuth,...incoming};
    const validated=validateTarget({
      ...input,authentication,
      selectable_by_users:input?.selectable_by_users??
        old?.public?.selectable_by_users??false,
      allowed_subjects:input?.allowed_subjects??old?.public?.allowed_subjects??[]
    },id);
    const password=validated.password||previous?.password||'';
    if(sqlAuthNeedsUserPassword(validated.authentication)&&!password)
      throw fail('New SQL target requires its database password');
    const profile={...validated,...(password?{password}:{})};
    // Never put a Token or Client Secret into unencrypted/public DO metadata.
    const {password:_password,authentication:internalAuth,...fields}=profile;
    const publicFields={...fields,
      authentication:publicSqlDriverAuthentication(internalAuth)};
    await this.ctx.storage.put('target:'+id,{
      public:publicFields,
      encrypted:await encryptProfile(profile,this.env.LOC_CONTROL_ENCRYPTION_KEY)
    });
    return publicFields;
  }
  // Per-user selection is stored in the existing Authority DO, not in
  // database tables, build-time JSON, or browser-held connection credentials.
  async databaseTargetsForUser(subject,isRoot=false){
    if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||'')))
      throw fail('Valid LOC subject required',401);
    const stored=await this.ctx.storage.list({prefix:'target:'});
    const targets=[...stored].flatMap(([key,item])=>{
      const info=item?.public||{};
      const authorized=isRoot||info.selectable_by_users===true||
        (Array.isArray(info.allowed_subjects)&&info.allowed_subjects.includes(subject));
      if(!authorized)return [];
      return [{id:key.slice('target:'.length),label:String(info.label||key),
        engine:info.engine,ref_provider:String(info.ref_provider||''),
        ref_permission:String(info.ref_permission||'')}];
    }).sort((a,b)=>a.label.localeCompare(b.label));
    const current=await this.ctx.storage.get('user-db:'+subject)||null;
    return {targets,selected:targets.some(x=>x.id===current)?current:null};
  }
  async selectDatabaseForUser(subject,id,isRoot=false){
    const choices=await this.databaseTargetsForUser(subject,isRoot);
    if(id===null||id==='configured'){
      await this.ctx.storage.delete('user-db:'+subject);
      return {selected:null};
    }
    if(!ID.test(String(id||''))||!choices.targets.some(x=>x.id===id))
      throw fail('Database is not available to this LOC account',403);
    await this.ctx.storage.put('user-db:'+subject,id);
    return {selected:id};
  }
  async selectedDatabaseForDelegation(subject,isRoot=false){
    const id=(await this.databaseTargetsForUser(subject,isRoot)).selected;
    if(id){
      const target=await this.ctx.storage.get('target:'+id);
      const {ref_provider,ref_permission}=target?.public||{};
      if(ref_provider)await this.checkAuthReference(subject,ref_provider,ref_permission);
    }
    return id;
  }
  async verifyLiveDatabaseSelection(subject,id,isRoot=false){
    return id===await this.selectedDatabaseForDelegation(subject,isRoot);
  }
  async selectPrimary(id){
    const builtin=id==='loc-main';
    const target=builtin?{id}:await this.ctx.storage.get('target:'+id);
    if(!target)throw fail('Unknown primary target');
    await this.ctx.storage.put('primary_id',id);
    return {primary_id:id};
  }
  // LOC Authority is stored outside *every* business SQL database.
  // Scope inheritance is never implicit: a rule applies to its exact Scope.
  async listGrants(){
    const saved=await this.ctx.storage.list({prefix:'grant:'});
    return [...saved].map(([key,grant])=>({key:key.slice(6),...grant}))
      .sort((a,b)=>a.key.localeCompare(b.key));
  }
  async putGrant(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid grant');
    const provider=String(input.provider||'').trim();
    const subject=String(input.subject||'').trim();
    const scope=String(input.scope||'').trim().toLowerCase();
    const actions=input.actions;
    const expires=Number(input.expires_at);
    const email=String(input.email||'').trim().toLowerCase();
    if(input.email!==undefined&&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw fail('Invalid manually verified LOC identity email');
    if(!/^[a-z][a-z0-9_-]{0,31}$/.test(provider)||
      !/^[a-zA-Z0-9_:-]{1,128}$/.test(subject)||
      !/^[a-z][a-z0-9]{0,14}$/.test(scope)||
      !Array.isArray(actions)||!actions.length||actions.length>16||
      actions.some(action=>!['read','write','manage','configure'].includes(action))||
      !Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+366*24*60*60*1000)
      throw fail('Invalid Authority grant');
    const unique=[...new Set(actions)].sort();
    const key=provider+':'+subject+':'+scope;
    await this.ctx.storage.put('grant:'+key,{provider,subject,scope,actions:unique,
      expires_at:expires,...(email?{email}:{})});
    return {key,provider,subject,scope,actions:unique,expires_at:expires,
      ...(email?{email}:{})};
  }
  async delegationGrantProfile(provider,subject){
    // Trusted, operator-maintained mapping on existing grants, not a new DB.
    const prefix='grant:'+provider+':'+subject+':';
    const entries=await this.ctx.storage.list({prefix});
    const now=Date.now(),scopes=[],emails=new Set();
    for(const [key,grant] of entries){
      if(grant?.provider!==provider||grant?.subject!==subject||
        grant.expires_at<=now)continue;
      const scope=key.slice(prefix.length);
      if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))continue;
      if(grant.email)emails.add(String(grant.email).toLowerCase());
      if(grant.actions?.includes('manage'))scopes.push(scope);
      if(scopes.length>64||emails.size>1)
        throw fail('Conflicting or excessive identity delegation',403);
    }
    return {scopes,email:[...emails][0]||''};
  }
  async revokeGrant(key){
    if(!/^[a-z][a-z0-9_-]{0,31}:[a-zA-Z0-9_:-]{1,128}:[a-z][a-z0-9]{0,14}$/.test(String(key)))
      throw fail('Invalid grant key');
    await this.ctx.storage.delete('grant:'+key);
    return {revoked:true,key};
  }
  // Scope grant checks are performed by LOC Auth before issuing signed,
  // short-lived application delegations.
  async mayAccess({provider,subject,scope,action}={}){
    if(!['read','write','manage','configure'].includes(action))return false;
    if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scope||'')))return false;
    const key='grant:'+provider+':'+subject+':'+scope;
    const grant=await this.ctx.storage.get(key);
    return Boolean(grant&&grant.expires_at>Date.now()&&grant.actions.includes(action));
  }

  async getMcpScope(scopeid){
    validScope(scopeid);
    const item=await this.ctx.storage.get('mcp-scope:'+scopeid);
    if(item){
      // Historical endpoint metadata stays encrypted in Durable Object storage
      // for migration only; it cannot select the application's Kysely target.
      return {scopeid,configured:false,needs_native_driver:true,
        legacy_gateway_retired:true,schema:String(item.public?.schema||'silver'),
        table:scopeid+'_galaxy'};
    }
    if(Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))
      return {scopeid,configured:true,managed:true,provider:'loc-kysely',
        schema:'silver',table:MANAGED_SCOPE_TABLES[scopeid]};
    return {scopeid,configured:false};
  }
  async mcpCheckpoint(scopeid,conversationId,updatedAt){
    validScope(scopeid);
    if(typeof conversationId!=='string'||conversationId.length<3||conversationId.length>150||
      /[\u0000-\u001f]/.test(conversationId))throw fail('Invalid conversation ID',400);
    const item=await this.ctx.storage.get('mcp-sync:'+scopeid+':'+conversationId)||null;
    return {scopeid,conversation_id:conversationId,
      updated_at:item?.updated_at||null,saved_at:item?.saved_at||null,uid:item?.uid||null,
      needs_save:updatedAt?!item?.saved_at||Date.parse(validTimestamp(updatedAt))>Date.parse(item.updated_at):null};
  }
  async mcpSave(scopeid,input,oauthToken=''){
    validScope(scopeid);
    if(!input||typeof input.conversation_id!=='string')throw fail('Conversation ID required',400);
    // Serialize saves for one conversation within the existing Durable Object.
    // One Scope Durable Object owns the record lock, shared by all Agents.
    const checkpoint=await this.mcpCheckpoint(scopeid,input.conversation_id);
    const key=scopeid+':'+(input.uid||checkpoint.uid||input.conversation_id);
    this.mcpInflight??=new Map();
    const previous=this.mcpInflight.get(key)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>this.mcpSaveUnlocked(scopeid,input,oauthToken));
    this.mcpInflight.set(key,next);
    try{return await next;}
    finally{if(this.mcpInflight.get(key)===next)this.mcpInflight.delete(key);}
  }
  async mcpSaveUnlocked(scopeid,input,oauthToken=''){
    validScope(scopeid);
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid conversation',400);
    const conversation_id=String(input.conversation_id||'');
    const requestedTime=validTimestamp(input.updated_at);
    const status=await this.mcpCheckpoint(scopeid,conversation_id,requestedTime);
    const append=input.append===true;
    const savedBatch=append?await this.ctx.storage.get('mcp-sync:'+scopeid+':'+conversation_id):null;
    if(!status.needs_save&&(!append||savedBatch?.last_batch_id===input.batch_id))
      return {...status,saved:false,reason:'unchanged'};
    if(typeof input.content!=='string'||!input.content.trim()||input.content.length>125000||
      typeof input.title!=='string'||input.title.length>350)
      throw fail('Invalid conversation content or title',400);
    const marker='[[GalaxyLinkBatch:'+input.batch_id+']]';
    if(append&&(!/^[0-9a-f]{64}$/.test(String(input.batch_id||''))||
      !input.content.startsWith(marker+'\n')))
      throw fail('Invalid Galaxy Link batch marker',400);
    if(input.uid!==undefined&&!UID.test(String(input.uid)))throw fail('Invalid topic UID',400);
    if(status.uid&&input.uid&&status.uid!==input.uid)throw fail('Conversation checkpoint UID conflict',409);
    const uid=status.uid||input.uid||newUid();
    const checkpointKey='mcp-sync:'+scopeid+':'+conversation_id;
    // Persist the stable UID before the HTTP write so a timeout or failed ack
    // never creates a second article on the next attempt.
    if(!status.uid)await this.ctx.storage.put(checkpointKey,
      {uid,updated_at:status.updated_at,saved_at:status.saved_at});
    // Append only the new source batch; never rewrite an older conversation.
    const useAppend=append&&Boolean(status.uid||input.uid);
    if(useAppend){
      let result=null;
      try{
        result=await managedMcpAppend(scopeid,uid,input.content,
          input.batch_id,requestedTime,oauthToken,this.env);
      }catch(error){
        // If the first insert never committed, retry using the SAME UID.
        // Only 404 on an unsaved checkpoint may fall back to initial INSERT.
        // A committed older batch is never overwritten by a retry.
        if(error?.status!==404||status.saved_at||input.uid)throw error;
      }
      if(result){
        const saved_at=new Date().toISOString();
        await this.ctx.storage.put(checkpointKey,{updated_at:requestedTime,saved_at,uid,
        ...(append?{last_batch_id:input.batch_id}:{})});
        return {scopeid,conversation_id,uid,title:result.title||null,
          createtime:result.createtime||null,updated_at:requestedTime,saved_at,saved:true,appended:true};
      }
    }
    if(input.uid&&append)throw fail('Existing MCP topic could not be resumed',409);
    const created=append?new Date().toISOString():validTimestamp(input.created_at||requestedTime);
    const title=append?'Galaxy Link｜'+scopeid+' 在 '+created+' 開始的原始文字紀錄':input.title;
    // Idempotent first insert by the existing case-sensitive UID; no table scans.
    const row={uid,title,content:input.content,
      site:'mcp',site_id:conversation_id,
      statics:false,culture:false,search:false,trace:false,list:false,keyword:false,extract:false,others:false,
      createtime:created,
      UpdateTime:requestedTime};
    await managedMcpInsert(scopeid,row,Boolean(status.uid),oauthToken,
      this.env);
    const saved_at=new Date().toISOString();
    this.mcpSearchCache?.clear();
    await this.ctx.storage.put(checkpointKey,{updated_at:requestedTime,saved_at,uid,
        ...(append?{last_batch_id:input.batch_id}:{})});
    return {scopeid,conversation_id,updated_at:requestedTime,saved_at,uid,title,createtime:created,saved:true,appended:false};
  }
  // GitHub PR records are not readable/searchable/updatable via Galaxy Link.
  async mcpUpdatePr(){throw fail('請至github頁面找尋PR相關資料！不開放搜尋PR!',410);}
  async mcpLinkSearch(scopeid,query,limit=5,oauthToken=''){
    if(mcpPrLookup(query))throw fail('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
    validScope(scopeid);
    if(typeof query!=='string'||query.trim().length<2||query.length>100||
      /[\u0000-\u001f\u007f]/.test(query)||!Number.isInteger(limit)||limit<1||limit>5)
      throw fail('Invalid Galaxy Link search',400);
    const rows=await managedMcpRead(scopeid,'mcp-search',{query,limit,user_requested:true},
      oauthToken,this.env);
    return {scopeid,results:rows.map(r=>({uid:r.uid,title:r.title,createtime:r.createtime}))};
  }
  async mcpSearch(scopeid,query,limit=5,oauthToken=''){
    // Retained internal caller; no unrestricted MCP content search remains.
    return this.mcpLinkSearch(scopeid,query,Math.min(limit,5),oauthToken);
  }
  async mcpRead(scopeid,uid,offset=0,max_chars=20000,oauthToken='',siteFilter=''){
    validScope(scopeid);
    if(siteFilter&&siteFilter!=='mcp')
      throw fail('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
    if(!UID.test(uid)||!Number.isInteger(offset)||offset<0||offset>1000000||
      !Number.isInteger(max_chars)||max_chars<1||max_chars>40000)
      throw fail('Invalid article read parameters',400);
    const rows=await managedMcpRead(scopeid,'mcp-read',{uid,site:'mcp'},
      oauthToken,this.env);
    if(!rows.length)return {found:false,scopeid,uid};
    const row=rows[0],content=String(row.content||'');
    return {found:true,scopeid,uid:row.uid,title:row.title,date:row.date,
      createtime:row.createtime,site:row.site,url:row.url,
      content:content.slice(offset,offset+max_chars),offset,total_chars:content.length,
      next_offset:offset+max_chars<content.length?offset+max_chars:null};
  }
  async addGroupScope(groupid,scopeid){
    validScope(groupid);validScope(scopeid);
    if(groupid===scopeid)throw fail('Scope cannot be its own group',400);
    await this.ctx.storage.put('mcp-group:'+groupid+':'+scopeid,true);
    this.mcpGroupCache?.clear();
    return {groupid,scopeid,linked:true};
  }
  async mcpGroupMembers(groupid){
    validScope(groupid);
    const saved=await this.ctx.storage.list({prefix:'mcp-group:'+groupid+':'});
    const set=new Set(groupid==='loc'?['lo3rwang','lrunes']:[]);
    for(const k of saved.keys())set.add(k.split(':').pop());
    return [...set].sort().slice(0,25);
  }
  async mcpGroupGrants(groupid){
    validScope(groupid);
    const members=[groupid,...await this.mcpGroupMembers(groupid)];
    const allowed=new Set(members);
    const grants=(await this.listGrants()).filter(grant=>
      grant.provider==='loc'&&allowed.has(grant.scope)&&grant.expires_at>Date.now());
    return {groupid,members,grants,
      categories:(await this.mcpGroupKeywordCategories(groupid)).categories};
  }
  async mcpGroupKeywordCategories(groupid){
    validScope(groupid);
    const members=new Set(await this.mcpGroupMembers(groupid));
    const prefix='mcp-keyword-category:'+groupid+':';
    const entries=await this.ctx.storage.list({prefix});
    const categories=[...entries.values()].filter(row=>members.has(row.scopeid))
      .sort((a,b)=>a.scopeid.localeCompare(b.scopeid)||a.class.localeCompare(b.class));
    return {groupid,categories};
  }
  async putMcpGroupKeywordCategory(groupid,scopeid,classUid){
    const members=await this.mcpGroupMembers(groupid);
    const valid=validateKeywordCategoryEntry(groupid,scopeid,classUid,members);
    await assertPublicKeywordClass(valid.scopeid,valid.class,{env:this.env});
    const sha=await hashKeywordCategory(valid.scopeid,valid.class);
    const record={...valid,sha};
    await this.ctx.storage.put('mcp-keyword-category:'+groupid+':'+scopeid+':'+classUid,record);
    return record;
  }
  async removeMcpGroupKeywordCategory(groupid,scopeid,classUid){
    const members=await this.mcpGroupMembers(groupid);
    validateKeywordCategoryEntry(groupid,scopeid,classUid,members);
    const removed=await this.ctx.storage.delete('mcp-keyword-category:'+groupid+':'+scopeid+':'+classUid);
    return {scopeid,class:classUid,removed:Boolean(removed)};
  }
  // Group search is retired. Do not fall back to public provider Data APIs.
  async mcpGroupSearch(){throw fail('MCP group search is disabled',403);}
  async mcpGroupSearchUncached(){throw fail('MCP group search is disabled',403);}
  // Shared, durable quotas for each verified LOC Auth MCP subject.
  // A read-only near-limit check for simultaneous PR denial + QoS warning.
  // It never acquires a lease, spends a search, or touches Galaxy rows.
  async mcpQuotaInspect(kind,subject){
    if(!/^loc:loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||'')))
      throw fail('Invalid MCP principal',401);
    if(!['read','write','search'].includes(kind))throw fail('Invalid MCP quota kind',400);
    const now=Date.now(),search=kind==='search';
    const cooldown=Number(await this.ctx.storage.get('mcp-qos-cooldown:'+subject)||0);
    if(cooldown>now)return {warning:'提醒！MCP QoS 已進入流量管制，請停止重試。'};
    const latest=search?await this.ctx.storage.get('mcp-qos-search:'+subject):null;
    if(latest&&now>=latest.at&&now-latest.at<300_000)
      return {warning:'提醒！短時間多次搜尋將進入流量管制。每五分鐘只能搜尋一次，請停止重試。'};
    const bucket=await this.ctx.storage.get('mcp-quota-window:'+subject);
    if(bucket&&now>=bucket.started&&now-bucket.started<60_000&&
       (bucket.count>=15||(kind!=='write'&&bucket.reads>=11)||
        (search&&bucket.searches>=1)))
      return {warning:'提醒！MCP QoS 即將達到限制，請放慢呼叫頻率。'};
    const leases=(await this.ctx.storage.get('mcp-quota-leases')||[])
      .filter(item=>item.expires>now);
    const reads=leases.filter(item=>item.kind!=='write').length;
    if(leases.length>=15||(kind!=='write'&&reads>=11))
      return {warning:'提醒！MCP QoS 即將達到限制，請放慢呼叫頻率。'};
    return {warning:''};
  }
  async mcpQuotaAcquire(kind,subject){
    if(!/^loc:loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||'')))throw fail('Invalid MCP principal',401);
    if(!['read','write','search'].includes(kind))throw fail('Invalid MCP quota kind',400);
    const now=Date.now(),period=60_000,leaseTtl=25_000;
    const searchWindowMs=300_000;
    const maximum=16;
    const outcome=await this.ctx.storage.transaction(async tx=>{
      const cooldownKey='mcp-qos-cooldown:'+subject;
      const searchKey='mcp-qos-search:'+subject;
      const latestSearch=kind==='search'?await tx.get(searchKey):null;
      const blockedUntil=Number(await tx.get(cooldownKey)||0);
      if(blockedUntil>now)return {rejected:'cooldown'};
      // Escalate *new* abuse incidents, not every request made while blocked.
      // After 24 quiet hours start again at three minutes; max one hour.
      const escalate=async()=>{
        const strikesKey='mcp-qos-strikes:'+subject;
        const last=await tx.get(strikesKey);
        const recent=last&&Number(last.at)<=now&&now-Number(last.at)<86_400_000;
        const strikes=recent?Math.min(6,Number(last.strikes||0)+1):1;
        const duration=Math.min(3_600_000,180_000*2**(strikes-1));
        await tx.put(strikesKey,{strikes,at:now});
        await tx.put(cooldownKey,now+duration);
      };
      const key='mcp-quota-window:'+subject;
      const prior=await tx.get(key);
      const bucket=prior&&now>=prior.started&&now-prior.started<period
        ?prior:{started:now,count:0,reads:0,searches:0,rateRejects:0};
      // Five-minute Galaxy search gate, shared across Scopes for the verified identity.
      // Denials count toward abuse detection without extending the initial timer.
      if(kind==='search'&&latestSearch&&now>=latestSearch.at&&
         now-latestSearch.at<searchWindowMs){
        const rejects=(latestSearch.rejects||0)+1;
        await tx.put(searchKey,{...latestSearch,rejects});
        if(rejects>=3){await escalate();return {rejected:'search-cooldown'};}
        return {rejected:'search-warning'};
      }
      const leases=(await tx.get('mcp-quota-leases')||[]).filter(item=>item.expires>now);
      const activeReads=leases.filter(item=>item.kind==='read'||item.kind==='search').length;
      const activeSearches=leases.filter(item=>item.kind==='search').length;
      // QoS: 16 total, with 12 read slots and four write reserves.
      if(bucket.count>=maximum||(kind!=='write'&&(bucket.reads||0)>=12)||
          (kind==='search'&&(bucket.searches||0)>=2)){
        // One over-limit request gets 429; repeated attempts in the same
        // minute activate the 3-minute cooldown (including search).
        const rateRejects=(bucket.rateRejects||0)+1;
        await tx.put(key,{...bucket,rateRejects});
        if(rateRejects>=3){
          // Durable Object transaction must commit before the caller throws.
          await escalate();
          return {rejected:'rate-cooldown'};
        }
        return {rejected:'rate'};
      }
      if(leases.length>=16||(kind!=='write'&&activeReads>=12)||
          (kind==='search'&&activeSearches>=2)){
        // Persist before returning: throwing inside a DO transaction rolls it back.
        await escalate();
        return {rejected:'concurrency'};
      }
      const lease=crypto.randomUUID();
      leases.push({lease,subject,kind,expires:now+leaseTtl});
      await tx.put(key,{started:bucket.started,count:bucket.count+1,
        reads:(bucket.reads||0)+(kind==='write'?0:1),
        searches:(bucket.searches||0)+(kind==='search'?1:0)});
      await tx.put('mcp-quota-leases',leases);
      if(kind==='search')await tx.put(searchKey,{
        at:now,count:(latestSearch?.count||0)+1,rejects:0});
      // A successful search consumes the single five-minute opportunity.
      // Other operations warn with one rate/concurrency slot remaining.
      const near=kind==='search'
        ?'提醒！每五分鐘只能搜尋一次，短時間重複搜尋會啟動流量管制。'
        :(bucket.count+1>=15||(kind!=='write'&&bucket.reads+1>=11)||
          leases.length>=15)
          ?'提醒！MCP QoS 即將達到限制，請放慢呼叫頻率。':'';
      return {lease,...(near?{warning:near}:{})};
    });
    if(outcome.rejected==='search-warning')throw fail('提醒！短時間多次搜尋將進入流量管制。每五分鐘只能搜尋一次，請停止重試。',429);
    if(outcome.rejected==='search-cooldown')throw fail('搜尋已進入流量管制，請停止重複呼叫 Galaxy 搜尋。',429);
    if(outcome.rejected==='cooldown'||outcome.rejected==='concurrency'||
       outcome.rejected==='rate-cooldown')
      throw fail('MCP request cooldown active',429);
    if(outcome.rejected==='rate')throw fail('MCP request limit exceeded',429);
    return outcome;
  }
  async mcpQuotaRelease(lease,subject){
    if(!/^loc:loc_[A-Za-z0-9_-]{32,80}$/.test(String(subject||'')))throw fail('Invalid MCP principal',401);
    if(typeof lease!=='string'||!/^[a-f0-9-]{36}$/i.test(lease))
      throw fail('Invalid MCP lease',400);
    await this.ctx.storage.transaction(async tx=>{
      const now=Date.now();
      const records=(await tx.get('mcp-quota-leases')||[]);
      if(records.some(item=>item.lease===lease&&item.subject!==subject))
        throw fail('MCP lease belongs to another subject',403);
      await tx.put('mcp-quota-leases',records
        .filter(item=>item.expires>now&&item.lease!==lease));
    });
    return {released:true};
  }
}

function mcpPrLookup(query){
  // PR and commit history are stored in GitHub, not Galaxy.
  return /(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i
    .test(String(query||''));
}

async function handleMcpAuthority(request,env,url,origin){
  // Authentication precedes all quotas and any downstream SQL access.
  // Browser administration uses a site-audience LOC OAuth token. MCP tools
  // keep the separate MCP audience. Both must pass explicit LOC Scope grants.
  const webAdmin=/^\/v1\/mcp\/(?:scope|group)\//.test(url.pathname);
  let principal;
  try{principal=await verifyNativeOAuth(request,env,MCP_AUDIENCE);}
  catch(error){
    if(!webAdmin)throw error;
    principal=await verifyNativeOAuth(request,env,WEB_AUDIENCE);
  }
  // Trusted MCP application queries its own Kysely connection. This
  // authorization endpoint returns ONLY the verified actor, Scope permission
  // and selected DB alias; it never returns SQL, a password, or a URL.
  const directPermit=/^\/v1\/mcp\/direct-permit\/([a-z][a-z0-9]{0,14})\/(read)$/.exec(url.pathname);
  if(directPermit){
    if(request.method!=='GET')throw fail('Method not allowed',405);
    const scopeid=validScope(directPermit[1]),action=directPermit[2];
    const state=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
    const root=await verifiedLocOwner(principal,env);
    const dbTarget=await state.selectedDatabaseForDelegation(principal.subject,root);
    return json({authorized:true,subject:principal.subject,scopeid,action,
      ...(dbTarget?{db_target:dbTarget}:{})},200,origin);
  }
  const quota=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName(
    'mcp-quota-global-v1'));
  if(url.pathname==='/v1/mcp/quota'&&request.method==='POST'){
    if(principal.provider!=='loc')throw fail('LOC MCP OAuth required',401);
    const args=await mcpJsonBody(request,400);
    if(args?.action==='inspect')return json(await quota.mcpQuotaInspect(args.kind,'loc:'+principal.subject),200,origin);
    if(args?.action==='acquire')return json(await quota.mcpQuotaAcquire(args.kind,'loc:'+principal.subject),200,origin);
    if(args?.action==='release')return json(await quota.mcpQuotaRelease(args.lease,'loc:'+principal.subject),200,origin);
    throw fail('Invalid MCP quota operation',400);
  }
  // Refuse GitHub metadata searches before quota or SQL, including direct API callers.
  if(/^\/v1\/mcp\/galaxy-link\/search\//.test(url.pathname)&&request.method==='POST'){
    const input=await mcpJsonBody(request.clone(),1600);
    if(mcpPrLookup(input?.query))
      throw fail('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
  }
  // No DB work and no quota spend on retired search endpoints.
  if(/^\/v1\/mcp\/(?:search|group-search)\//.test(url.pathname))
    throw fail('MCP search is disabled',403);
  // Retired PR write API must fail closed even for authenticated legacy clients.
  // GitHub owns PR history. Reject before quota and any database work.
  if(/^\/v1\/mcp\/update-pr\//.test(url.pathname))
    throw fail('請至github頁面找尋PR相關資料！不開放搜尋PR!',410);
  const kind=/^\/v1\/mcp\/galaxy-link\/search\//.test(url.pathname)?'search':
    request.method==='GET'?'read':'write';
  const ticket=await quota.mcpQuotaAcquire(kind,'loc:'+principal.subject);
  try{
    const answer=await handleMcpAuthorityInner(request,env,url,origin,principal);
    if(!ticket.warning||!answer.ok)return answer;
    const headers=new Headers(answer.headers);
    // HTTP headers are ASCII; encode the warning for the MCP caller.
    headers.set('X-LOC-QoS-Warning',encodeURIComponent(ticket.warning));
    headers.set('Access-Control-Expose-Headers','X-LOC-QoS-Warning');
    return new Response(answer.body,{status:answer.status,statusText:answer.statusText,headers});
  }finally{await quota.mcpQuotaRelease(ticket.lease,'loc:'+principal.subject);}
}
async function handleMcpAuthorityInner(request,env,url,origin,principal){
  const isRoot=await verifiedLocOwner(principal,env);
  const stub=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
  const scoped=scope=>env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('mcp-scope:'+scope));
  const allowed=async(scope,action)=>action==='read'||isRoot;
  // A trusted Scope grant becomes a short-lived LOC MCP delegation.
  // The selected database alias is a signed claim verified by the LOC app.
  const managedToken=async(scope,action)=>{
    validScope(scope);
    if(!['read','write','manage'].includes(action)||!await allowed(scope,action))
      throw fail('MCP Scope delegation denied',403);
    const targetId=await stub.selectedDatabaseForDelegation(principal.subject,isRoot);
    const claims=issueDelegation({
      sub:principal.subject,email:principal.email,grants:[scope+':'+action],audience:'mcp',targetId,
      sid:crypto.randomUUID(),now:Math.floor(Date.now()/1000),seconds:300
    });
    return stub.signLocDelegation(claims);
  };
  const parts=url.pathname.split('/').filter(Boolean).slice(2);
  const galaxyLink=parts[0]==='galaxy-link';
  if(galaxyLink)parts.shift();
  if(galaxyLink&&!['search','read','checkpoint','sync'].includes(parts[0]))
    throw fail('Invalid Galaxy Link action',404);
  // Legacy MCP searches remain disabled; only the new versioned Link may search.
  if((parts[0]==='group-search'||parts[0]==='search'&&!galaxyLink)&&request.method==='POST')
    throw fail('MCP search is disabled',403);
  if(parts[0]==='scope'&&parts.length===2){
    const scopeid=validScope(parts[1]);
    if(request.method==='GET'){
      if(!await allowed(scopeid,'read')&&!await allowed(scopeid,'write')&&!await allowed(scopeid,'configure'))throw fail('Scope access denied',403);
      return json(await scoped(scopeid).getMcpScope(scopeid),200,origin);
    }
    if(request.method==='PUT')throw fail('Scope database URL registration is retired',410);
  }
  if(['authorize-read','authorize-write'].includes(parts[0])&&
     parts.length===2&&request.method==='GET'){
    const scopeid=validScope(parts[1]),isRead=parts[0]==='authorize-read';
    const source=url.searchParams.get('source')||'mcp';
    if(!['mcp','github'].includes(source)||(source==='github'&&!isRead))
      throw fail('Invalid managed MCP source',400);
    const action=isRead?(source==='github'?'manage':'read'):'write';
    // Managed Scope uses the existing, signed LOC root email rather than a
    // second env identity that could be missing or drift from LOC Auth.
    if(!isRoot||!await allowed(scopeid,action))
      throw fail('Managed Scope '+action+' denied',403);
    if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Managed Scope is not supported',404);
    const email=String(principal.email||'').trim().toLowerCase();
    if(principal.emailVerified!==true||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw fail('Verified LOC root email required',403);
    return json({provider:'loc',subject:principal.subject,scopeid,email,authorized:true},200,origin);
  }
  if(parts[0]==='checkpoint'&&parts.length===3&&request.method==='GET'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'write'))throw fail('Scope sync denied',403);
    const conversationId=decodeURIComponent(parts[2]);
    // Extension connection only probes the verified write grant. Do not touch
    // per-Scope DO storage just to check a non-existent, reserved conversation.
    if(galaxyLink&&conversationId==='loc-galaxy-extension-connection-probe')
      return json({scopeid,conversation_id:conversationId,updated_at:null,
        saved_at:null,uid:null,needs_save:true},200,origin);
    return json(await scoped(scopeid).mcpCheckpoint(scopeid,conversationId,
      url.searchParams.get('updated_at')||undefined),200,origin);
  }
  if(parts[0]==='sync'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'write'))throw fail('Scope sync denied',403);
    const input=await mcpJsonBody(request);
    if(galaxyLink)input.append=true;
    return json(await scoped(scopeid).mcpSave(scopeid,input,
      await managedToken(scopeid,'write')),200,origin);
  }
  if(parts[0]==='update-pr'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'manage'))throw fail('PR update requires Scope manager',403);
    return json(await scoped(scopeid).mcpUpdatePr(scopeid,await mcpJsonBody(request),
      await managedToken(scopeid,'manage')),200,origin);
  }
  if(parts[0]==='search'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    const args=await mcpJsonBody(request,1600);
    if(!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).some(key=>!['query','limit','user_requested'].includes(key))||
      args.user_requested!==true)
      throw fail('Invalid Galaxy Link search payload',400);
    if(!await allowed(scopeid,'read'))
      throw fail('Scope source search denied',403);
    return json(await scoped(scopeid).mcpLinkSearch(scopeid,args.query,args.limit??5,
      await managedToken(scopeid,'read')),200,origin);
  }
  if(parts[0]==='read'&&parts.length===3&&request.method==='GET'){
    const scopeid=validScope(parts[1]);
    const groupid=url.searchParams.get('groupid')||'';
    const requestedSite=galaxyLink?(url.searchParams.get('site')||'mcp'):
      (url.searchParams.get('site')==='mcp'?'mcp':'');
    if(galaxyLink&&requestedSite!=='mcp')
      throw fail('GitHub PR records are no longer served by Galaxy Link; use GitHub tools',410);
    let permitted=await allowed(scopeid,requestedSite==='github'?'manage':'read');
    if(!permitted&&requestedSite!=='github'&&groupid&&await allowed(validScope(groupid),'read')){
      permitted=(await stub.mcpGroupMembers(groupid)).includes(scopeid);
    }
    if(!permitted)throw fail('Scope article read denied',403);
    const offset=Number(url.searchParams.get('offset')||'0');
    const max_chars=Number(url.searchParams.get('max_chars')||'20000');
    const result=await scoped(scopeid).mcpRead(scopeid,parts[2],offset,max_chars,
      await managedToken(scopeid,requestedSite==='github'?'manage':'read'),requestedSite);
    // Legacy UID reads must not let a normal read grant disclose private PRs.
    if(result.found&&result.site==='github'&&!await allowed(scopeid,'manage'))
      throw fail('GitHub development record requires Scope manager',403);
    return json(result,200,origin);
  }
  if(parts[0]==='group-search'&&parts.length===2&&request.method==='POST'){
    const groupid=validScope(parts[1]);
    if(!await allowed(groupid,'read'))throw fail('Group search denied',403);
    const args=await mcpJsonBody(request,1600);
    return json(await stub.mcpGroupSearch(groupid,args.query,args.limit||10),200,origin);
  }
  if(parts[0]==='group'&&parts.length===3&&parts[2]==='grants'&&request.method==='GET'){
    const groupid=validScope(parts[1]);
    if(!await allowed(groupid,'manage'))throw fail('Group grants denied',403);
    return json(await stub.mcpGroupGrants(groupid),200,origin);
  }
  if(parts[0]==='group'&&parts.length===3&&parts[2]==='category'&&
      (request.method==='PUT'||request.method==='POST')){
    const groupid=validScope(parts[1]);
    if(!await allowed(groupid,'manage'))throw fail('Group Category management denied',403);
    const input=await mcpJsonBody(request,600);
    const scopeid=validScope(input?.scopeid),classUid=String(input?.class_uid||'');
    return json(request.method==='PUT'
      ?await stub.putMcpGroupKeywordCategory(groupid,scopeid,classUid)
      :await stub.removeMcpGroupKeywordCategory(groupid,scopeid,classUid),200,origin);
  }
  if(parts[0]==='group'&&parts.length===3&&parts[2]==='grant'&&request.method==='PUT'){
    const groupid=validScope(parts[1]);
    if(!await allowed(groupid,'manage'))throw fail('Group grants denied',403);
    const input=await mcpJsonBody(request,2000);
    const scopeid=validScope(input?.scope);
    if(scopeid!==groupid&&!(await stub.mcpGroupMembers(groupid)).includes(scopeid))
      throw fail('Requested Scope is not a Group member',403);
    return json(await stub.putGrant({provider:'loc',subject:input?.subject,
      scope:scopeid,actions:input?.actions,expires_at:input?.expires_at}),200,origin);
  }
  if(parts[0]==='group'&&parts.length===4&&parts[2]==='scope'&&request.method==='PUT'){
    const groupid=validScope(parts[1]),scopeid=validScope(parts[3]);
    if(!await allowed(groupid,'manage')||!await allowed(scopeid,'configure'))
      throw fail('Group and Scope consent required',403);
    return json(await stub.addGroupScope(groupid,scopeid),200,origin);
  }
  if(parts[0]==='group'&&parts.length===3&&parts[2]==='revoke'&&request.method==='POST'){
    const groupid=validScope(parts[1]);
    if(!await allowed(groupid,'manage'))throw fail('Group management denied',403);
    const input=await mcpJsonBody(request,1000),scopeid=validScope(input?.scope);
    if(scopeid!==groupid&&!(await stub.mcpGroupMembers(groupid)).includes(scopeid))
      throw fail('Scope is not a Group member',403);
    if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(String(input?.subject||'')))throw fail('Invalid LOC subject',400);
    return json(await stub.revokeGrant('loc:'+input.subject+':'+scopeid),200,origin);
  }
  throw fail('MCP operation not found',404);
}

// One exchange from a verified external identity to a narrowly scoped LOC
// delegation. Reuses Authority's existing grants; does not create an Auth RPC.
async function exchangeLocDelegation(request,env,principal,origin){
  const raw=await request.text();
  if(raw.length>1200)throw fail('Delegation request is too large',413);
  let input;
  try{input=JSON.parse(raw)}catch{throw fail('Invalid delegation request',400)}
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['audience','scopeid','actions','global','identity','self'].includes(k)))
    throw fail('Invalid delegation request',400);
  const audience=String(input.audience||'sql');
  const global=input.global===true,identity=input.identity===true,self=input.self===true;
  if(!['sql','mcp'].includes(audience)||
    input.global!==undefined&&typeof input.global!=='boolean'||
    input.identity!==undefined&&typeof input.identity!=='boolean'||
    input.self!==undefined&&typeof input.self!=='boolean'||
    (global||identity||self)&&audience!=='sql'||
    Number(global)+Number(identity)+Number(self)>1)
    throw fail('Invalid delegation audience',400);
  // OAuth-verified email is the sole write authority. Scope grants, root
  // subject lists and role strings cannot elevate another identity.
  if(principal?.provider!=='loc'||principal.emailVerified!==true)
    throw fail('Verified LOC OAuth identity required',403);
  const root=await verifiedLocOwner(principal,env);
  const scope=String(input.scopeid||'');
  const actions=input.actions;
  if(global){
    if(!root||input.scopeid!==undefined||input.actions!==undefined)
      throw fail('Administrator delegation required',403);
  }else if(identity||self){
    if(input.scopeid!==undefined||input.actions!==undefined)
      throw fail('Identity-only delegation cannot request Scope access',400);
  }else if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||
    !Array.isArray(actions)||!actions.length||actions.length>3||
    actions.some(a=>!['read','write','manage'].includes(a)))
    throw fail('Invalid requested delegation scope',400);
  if(!root&&Array.isArray(actions)&&actions.some(a=>a!=='read'))
    throw fail('Only the LOC owner may request writes',403);
  const stub=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
  const email=String(principal.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw fail('Verified identity email required for LOC delegation',403);
  const grants=global||self?(root?['global:manage']:[]):
    identity?[]:[...new Set(actions)].map(a=>scope+':'+a);
  // Native LOC account subjects are immutable; matching email never
  // transfers an existing owner's grants or identity.
  const now=Math.floor(Date.now()/1000);
  const sub=principal.subject;
  const targetId=principal.provider==='loc'?
    await stub.selectedDatabaseForDelegation(principal.subject,root):null;
  const claims=issueDelegation({sub,email,
    grants,audience,sid:crypto.randomUUID(),now,seconds:300,targetId});
  const token=await stub.signLocDelegation(claims);
  return json({access_token:token,token_type:'Bearer',expires_at:claims.exp,
    audience:claims.aud,scopeid:global||identity||self?null:scope,grants:claims.grants},200,origin);
}

export default {
  async fetch(request,env){
    let origin='';
    try{
      const target=new URL(request.url);
      // LOC identities enter through Google/GitHub OAuth only. Never accept
      // account/password creation, password login, or password resets.
      if(target.pathname.startsWith('/api/auth/'))
        return handleFirstPartyAuth(request,env);
      if(isNativeOAuthPath(target.pathname))return handleNativeOAuth(request,env);
      requireSetup(env);
      origin=allowedOrigin(request,env);
      if(request.method==='OPTIONS'){
        if(!origin)throw fail('Origin required',403);
        return new Response(null,{status:204,headers:{
          'access-control-allow-origin':origin,'access-control-allow-methods':'GET,PUT,POST,OPTIONS',
          'access-control-allow-headers':'authorization,content-type',
          'access-control-max-age':'600','vary':'origin'
        }});
      }
      if(!origin&&request.headers.get('sec-fetch-site')==='cross-site')throw fail('Cross-origin request rejected',403);
      if(!['GET','PUT','POST'].includes(request.method))throw fail('Method not allowed',405);
      const url=new URL(request.url);
      // External identity/delegation lookups share native Auth HTTP QoS.
      // Existing MCP business-search QoS stays a separate quota.
      const limited=await checkExternalAuthQos(request,env);
      if(limited)return limited;
      if(url.pathname.startsWith('/v1/mcp/'))return handleMcpAuthority(request,env,url,origin);
      if(request.method==='GET'&&url.pathname==='/.well-known/jwks.json'){
        const state=env.LOC_AUTHORITY_STATE.get(
          env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
        return new Response(JSON.stringify(await state.delegationJwks()),{
          status:200,headers:{'content-type':'application/json; charset=utf-8',
            'cache-control':'public, max-age=300','x-content-type-options':'nosniff'}
        });
      }
      // Trusted application backends fetch a selected connection profile.
      // This endpoint NEVER executes SQL and is inaccessible to OAuth users.
      const profileMatch=/^\/v1\/internal\/database\/([a-z][a-z0-9_-]{0,63})$/
        .exec(url.pathname);
      if(profileMatch){
        if(request.method!=='GET')throw fail('Method not allowed',405);
        const expected=String(env.LOC_DB_PROFILE_SERVICE_TOKEN||'');
        const supplied=String(request.headers.get('x-loc-service-token')||'');
        if(expected.length<32||supplied.length!==expected.length)
          throw fail('Trusted LOC backend required',403);
        let mismatch=0;
        for(let i=0;i<expected.length;i++)
          mismatch|=expected.charCodeAt(i)^supplied.charCodeAt(i);
        if(mismatch!==0)throw fail('Trusted LOC backend required',403);
        const owner=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName(
          'loc-authority-control-v1'));
        return json(await owner.trustedDatabaseProfile(profileMatch[1]),200,'');
      }
      const principal=await verifyNativeOAuth(request,env,WEB_AUDIENCE);
      if(!url.pathname.startsWith('/v1/'))throw fail('Not found',404);
      // Identity endpoint is only a verified principal lookup. It grants no
      // data access or management capabilities; the trusted app checks grants.
      if(request.method==='GET'&&url.pathname==='/v1/identity')return json(principal,200,origin);
      const control=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName(
        'loc-authority-control-v1'));
      if(request.method==='GET'&&url.pathname==='/v1/auth/ref/status')
        return json({references:await control.authReferenceStatus(principal.subject)},200,origin);
      if(request.method==='POST'&&url.pathname==='/v1/auth/ref/check'){
        const raw=await request.text();
        if(raw.length>13000)throw fail('Auth Ref proof is too large',413);
        let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid Auth Ref request',400)}
        if(!input||typeof input!=='object'||Array.isArray(input)||
          Object.keys(input).some(key=>!['provider','credential'].includes(key))||
          !AUTH_PROVIDER_TYPES.includes(input.provider))
          throw fail('Invalid Auth Ref provider',400);
        const profile=await control.authRefProfile(input.provider);
        const proof=await verifyAuthReference(input.provider,input.credential,profile);
        return json(await control.recordAuthReference(principal.subject,proof),200,origin);
      }
      if(request.method==='POST'&&url.pathname==='/v1/delegation')
        return await exchangeLocDelegation(request,env,principal,origin);
      // Account-level database selection is independent for each LOC identity.
      // Only profiles explicitly exposed by the root are selectable by users.
      if(url.pathname==='/v1/databases'||
         url.pathname==='/v1/databases/selection'){
        if(principal.provider!=='loc')throw fail('LOC Auth required',401);
        const state=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName(
          'loc-authority-control-v1'));
        const isRoot=await verifiedLocOwner(principal,env);
        if(request.method==='GET'&&url.pathname==='/v1/databases')
          return json(await state.databaseTargetsForUser(principal.subject,isRoot),200,origin);
        if(request.method==='POST'&&url.pathname==='/v1/databases/selection'){
          const raw=await request.text();
          if(raw.length>600)throw fail('Database selection is too large',413);
          let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid database selection')}
          if(!input||typeof input!=='object'||Array.isArray(input)||
            Object.keys(input).some(x=>x!=='id'))
            throw fail('Invalid database selection');
          return json(await state.selectDatabaseForUser(principal.subject,
            input.id,isRoot),200,origin);
        }
        throw fail('Method not allowed',405);
      }
      if(!await verifiedLocOwner(principal,env))throw fail('LOC owner required',403);
      const stub=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
      if(request.method==='GET'&&url.pathname==='/v1/me')return json(principal,200,origin);
      if(request.method==='GET'&&url.pathname==='/v1/state')return json(await stub.listState(),200,origin);
      if(request.method==='GET'&&url.pathname==='/v1/auth/providers')
        return json(await stub.listAuthProviders(),200,origin);
      const authMatch=/^\/v1\/auth\/providers\/(github|oidc|entra|ldap|ad|clerk)$/.exec(url.pathname);
      if(request.method==='PUT'&&authMatch){
        const raw=await request.text();
        if(raw.length>12000)throw fail('Request too large',413);
        let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON')}
        return json(await stub.putAuthProvider(authMatch[1],input),200,origin);
      }
      if(request.method==='GET'&&url.pathname==='/v1/grants')return json({grants:await stub.listGrants()},200,origin);
      if(request.method==='PUT'&&url.pathname==='/v1/grants'){
        const raw=await request.text();if(raw.length>3000)throw fail('Request too large',413);
        let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON')}
        return json(await stub.putGrant(input),200,origin);
      }
      if(request.method==='POST'&&url.pathname==='/v1/revoke'){
        const raw=await request.text();if(raw.length>1000)throw fail('Request too large',413);
        let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON')}
        return json(await stub.revokeGrant(input?.key),200,origin);
      }
      const match=/^\/v1\/targets\/([a-z][a-z0-9_-]{0,63})$/.exec(url.pathname);
      if(request.method==='PUT'&&match){
        const raw=await request.text();
        if(raw.length>10_000)throw fail('Request too large',413);
        let value;try{value=JSON.parse(raw)}catch{throw fail('Invalid JSON')}
        return json(await stub.putTarget(match[1],value),200,origin);
      }
      if(request.method==='POST'&&url.pathname==='/v1/primary'){
        const raw=await request.text();
        if(raw.length>1000)throw fail('Request too large',413);
        let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON')}
        if(!ID.test(String(input?.id||'')))throw fail('Invalid primary target');
        // Preference is persisted here; the LOC application resolves
        // the selected alias using its own native Kysely driver.
        const selected=await stub.selectPrimary(input.id);
        return json({...selected,runtime_connected:false},200,origin);
      }
      throw fail('Not found',404);
    }catch(error){
      const code=Number(error?.status)||500;
      return json({error:code>=500?'Recovery control unavailable':String(error.message)},code,origin);
    }
  }
};

