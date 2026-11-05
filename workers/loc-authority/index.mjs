import { DurableObject } from 'cloudflare:workers';
import {validateKeywordCategoryEntry,hashKeywordCategory,assertPublicKeywordClass} from './keyword-categories.mjs';
import {AUTH_PROVIDER_TYPES,validateAuthProviderSettings,publicAuthProviderSettings}
  from '../../app/loc/auth/auth-provider-settings.mjs';
// LOC independent recovery control plane. Never imports a database client or Supabase Auth.
// The separate Worker is provisioned only when Clerk + root identity + encryption secrets exist.
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const ENGINES=new Set(['postgres','mysql','mssql']);
function fail(message,status=400){return Object.assign(new Error(message),{status});}
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
// Clerk's JWKS origin is pinned to the trusted deployment issuer, not JWT data.
// The deployment can use accounts.dev or its custom Production HTTPS domain.
function isClerkIssuer(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
      ['','/'].includes(url.pathname)&&Boolean(url.hostname)&&
      !url.hostname.endsWith('.local');
  }catch{return false;}
}
const jwksCache=new Map();
const jwksPending=new Map();
async function clerkPublicKey(issuer,kid){
  if(!isClerkIssuer(issuer))throw fail('Clerk issuer is not trusted',503);
  if(!/^[A-Za-z0-9._-]{1,256}$/.test(String(kid||'')))throw fail('Invalid signing key ID',401);
  const key=issuer+'#'+kid;
  const cached=jwksCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.key;
  // One promise per issuer/key per isolate prevents duplicate Clerk calls
  // during concurrent requests (including MCP acquire/release).
  let pending=jwksPending.get(key);
  if(pending)return pending;
  pending=fetchClerkPublicKey(issuer,kid,key);
  jwksPending.set(key,pending);
  try{return await pending;}
  finally{if(jwksPending.get(key)===pending)jwksPending.delete(key);}
}
async function fetchClerkPublicKey(issuer,kid,key){
  const jwksUrl=(String(issuer).endsWith('/')?String(issuer).slice(0,-1):String(issuer))+'/.well-known/jwks.json';
  const edge=globalThis.caches?.default;
  const request=new Request(jwksUrl,{headers:{accept:'application/json'}});
  let response=edge?await edge.match(request).catch(()=>null):null;
  if(!response){
    response=await fetch(jwksUrl,{
      method:'GET',redirect:'follow',signal:AbortSignal.timeout(6000),
      headers:{accept:'application/json'}
    });
    if(!response.ok)throw fail('Clerk signing keys are unavailable',503);
    // JWKS is public signing-key metadata; store only successful responses
    // at the edge, at most five minutes, never tokens or private identities.
    if(edge){
      const copy=response.clone();
      const cachedHeaders=new Headers(copy.headers);
      cachedHeaders.set('Cache-Control','public, max-age=300');
      await edge.put(request,new Response(copy.body,{status:200,headers:cachedHeaders})).catch(()=>{});
    }
  }
  if(!response.ok)throw fail('Clerk signing keys are unavailable',503);
  const body=await response.text();
  if(body.length>120000)throw fail('Clerk signing key response too large',503);
  let keys;try{keys=JSON.parse(body).keys}catch{throw fail('Invalid Clerk signing keys',503)}
  if(!Array.isArray(keys))throw fail('Invalid Clerk signing keys',503);
  const jwk=keys.find(value=>value?.kid===kid&&value.kty==='RSA'&&
    (!value.alg||value.alg==='RS256')&&
    (!value.use||value.use==='sig')&&typeof value.n==='string'&&
    typeof value.e==='string');
  if(!jwk)throw fail('Clerk signing key is not recognized',401);
  // Clerk JWKS may contain additional metadata; the trusted RSA
  // modulus and exponent are enough to construct a verification-only key.
  // Do not allow JWKS metadata to change the pinned RS256 algorithm.
  if(jwk.key_ops&&(!Array.isArray(jwk.key_ops)||!jwk.key_ops.includes('verify')))
    throw fail('Clerk signing key is not usable for verification',503);
  if(!/^[A-Za-z0-9_-]+$/.test(jwk.n)||!/^[A-Za-z0-9_-]+$/.test(jwk.e))
    throw fail('Clerk signing key format is invalid',503);
  try{
    if(b64bytes(jwk.n).byteLength<256)throw Error('RSA key shorter than 2048 bits');
  }catch{throw fail('Clerk signing key format is invalid',503);}
  let cryptoKey;
  try{
    cryptoKey=await crypto.subtle.importKey('jwk',
      {kty:'RSA',n:jwk.n,e:jwk.e,alg:'RS256',use:'sig'},
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  }catch{
    throw fail('Clerk signing key import failed',503);
  }
  jwksCache.set(key,{key:cryptoKey,expires:Date.now()+5*60*1000});
  if(jwksCache.size>16)jwksCache.delete(jwksCache.keys().next().value);
  return cryptoKey;
}
function requireSetup(env){
  const hasClerk=Boolean(env.LOC_CLERK_ISSUER&&env.LOC_RECOVERY_ROOT_CLERK_IDS&&
    (env.LOC_CLERK_JWT_PUBLIC_KEY||isClerkIssuer(env.LOC_CLERK_ISSUER)));
  const hasAlternative=Boolean(env.LOC_SECONDARY_ISSUER&&env.LOC_SECONDARY_JWT_PUBLIC_KEY&&
    env.LOC_SECONDARY_AUDIENCE&&env.LOC_RECOVERY_ROOT_SECONDARY_SUBJECTS);
  if((!hasClerk&&!hasAlternative)||!env.LOC_CONTROL_ORIGIN||
    !env.LOC_CONTROL_ENCRYPTION_KEY||!env.LOC_AUTHORITY_STATE)
    throw fail('Recovery control is not configured',503);
}
async function verifyIdentityToken(request,env){
  const match=/^Bearer ([A-Za-z0-9_\-.]+)$/.exec(request.headers.get('authorization')||'');
  if(!match||match[1].length>8192)throw fail('Authentication required',401);
  const pieces=match[1].split('.');
  if(pieces.length!==3)throw fail('Invalid token',401);
  let header,claims;
  try{
    header=JSON.parse(new TextDecoder().decode(b64bytes(pieces[0])));
    claims=JSON.parse(new TextDecoder().decode(b64bytes(pieces[1])));
  }catch{throw fail('Invalid token',401)}
  if(header?.alg!=='RS256'||!claims||typeof claims!=='object')throw fail('Invalid token algorithm',401);
  const origin=String(env.LOC_CONTROL_ORIGIN).replace(/\/$/,'');
  const issuer=String(claims.iss||'').replace(/\/$/,'');
  const clerk=Boolean(env.LOC_CLERK_ISSUER&&issuer===String(env.LOC_CLERK_ISSUER).replace(/\/$/,''));
  const secondary=Boolean(env.LOC_SECONDARY_ISSUER&&issuer===String(env.LOC_SECONDARY_ISSUER).replace(/\/$/,''));
  if(!clerk&&!secondary)throw fail('Unknown identity issuer',401);
  const now=Math.floor(Date.now()/1000);
  if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||
    !Number.isInteger(claims.exp)||claims.exp<=now||
    !Number.isInteger(claims.iat)||claims.iat>now+5||
    !Number.isInteger(claims.nbf)||claims.nbf>now+5||
    claims.sts==='pending'||claims.act)throw fail('Session is not valid',401);
  // Clerk may omit azp when the Frontend API request had no Origin.
  // If present, azp must still match the single configured LOC origin.
  // The request's own Origin is separately restricted in allowedOrigin().
  if(clerk&&claims.azp!=null&&claims.azp!==''&&claims.azp!==origin)
    throw fail('Clerk authorized party does not match LOC',401);
  if(clerk&&(!/^user_[A-Za-z0-9]+$/.test(claims.sub)||
    typeof claims.sid!=='string'||!claims.sid.startsWith('sess_')))
    throw fail('Clerk session subject or ID is invalid',401);
  if(secondary&&(!env.LOC_SECONDARY_AUDIENCE||
    !(Array.isArray(claims.aud)?claims.aud.includes(env.LOC_SECONDARY_AUDIENCE):claims.aud===env.LOC_SECONDARY_AUDIENCE)))
    throw fail('Invalid token audience',401);
  let key;
  if(clerk&&!env.LOC_CLERK_JWT_PUBLIC_KEY){
    key=await clerkPublicKey(env.LOC_CLERK_ISSUER,header.kid);
  }else{
    const pem=String(clerk?env.LOC_CLERK_JWT_PUBLIC_KEY:env.LOC_SECONDARY_JWT_PUBLIC_KEY);
    const body=pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'');
    if(!body)throw fail('Recovery signing key unavailable',503);
    try{
      key=await crypto.subtle.importKey('spki',b64bytes(body),
        {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    }catch{throw fail('Signing key import failed',503);}
  }
  let verified=false;
  try{
    verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
      b64bytes(pieces[2]),new TextEncoder().encode(pieces[0]+'.'+pieces[1]));
  }catch(error){
    if(error?.status)throw error;
    throw fail('Signature verification operation failed',503);
  }
  if(!verified)throw fail('Token signature invalid',401);
  // Email is usable for legacy management grants only when it is a VERIFIED,
  // cryptographically signed identity claim. Never promote SDK/local input.
  const email=String(claims.email||'').trim().toLowerCase();
  const emailFormat=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const verifiedEmail=claims.email_verified===true&&emailFormat.test(email)?email:'';
  // Default Clerk session JWTs contain sub/sid but usually NO signed email.
  // This deployment's sole root has an independent trusted server-side
  // management-email binding. Never use an email supplied by the browser.
  const roots=String(env.LOC_RECOVERY_ROOT_CLERK_IDS||'').split(/[\s,;]+/).filter(Boolean);
  const rootEmail=String(env.LOC_ROOT_MANAGEMENT_EMAIL||'').trim().toLowerCase();
  const mappedEmail=clerk&&roots.length===1&&roots[0]===claims.sub&&
    emailFormat.test(rootEmail)?rootEmail:'';
  return {provider:clerk?'clerk':'secondary',subject:claims.sub,
    session:clerk?claims.sid:'verified',email:verifiedEmail||mappedEmail};
}
function validateTarget(input,id){
  if(!ID.test(id)||!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid target');
  const engine=String(input.engine||'');
  const host=String(input.host||'').trim().toLowerCase();
  const database=String(input.database||'').trim();
  const username=String(input.username||'').trim();
  const label=String(input.label||id).trim();
  const port=Number(input.port);
  if(!ENGINES.has(engine)||!/^[a-z0-9.-]{1,253}$/.test(host)||host.startsWith('.')||host.endsWith('.')||
    !Number.isInteger(port)||port<1||port>65535||
    !/^[a-zA-Z0-9_\-]{1,120}$/.test(database)||!username||username.length>120||!label||label.length>120)
    throw fail('Invalid database connection metadata');
  const password=input.password;
  if(password!==undefined&&(typeof password!=='string'||password.length>4096))throw fail('Invalid database secret');
  return {id,engine,host,port,database,username,label,...(password?{password}:{})};
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

// MCP OAuth uses an audience-bound access token, not a Clerk session JWT.
// Data access is separately authorized by this Group Authority's grants.
const MCP_RESOURCE='https://loc.lo3rwang.cc/mcp';
const MANAGED_SCOPE_TABLES=Object.freeze({lo3rwang:'lo3rwang_galaxy',lrunes:'lrunes_galaxy'});
const MANAGED_SUPABASE_EDGE='https://qlouywsdiiyiyzpoxyqy.supabase.co/functions/v1/loc-kysely-clerk';
// A publishable key identifies the project, not the user; the Clerk OAuth
// token is independently verified by the Kysely Edge and LOC Authority.
const MANAGED_PUBLISHABLE_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;
const TABLE_ID=/^[a-z][a-z0-9_]{0,62}$/;
const UID=/^[A-Za-z0-9]{8}$/;
function validScope(value){if(!SCOPE_ID.test(String(value||'')))throw fail('Invalid Scope',400);return value;}
function validTimestamp(value){
  const stamp=Date.parse(String(value||''));
  if(!Number.isFinite(stamp)||!/^\d{4}-\d\d-\d\dT/.test(String(value)))throw fail('Invalid source update time',400);
  return new Date(stamp).toISOString();
}
function safePostgrestUrl(value){
  const u=new URL(String(value||''));
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
    u.pathname.replace(/\/+$/,'')!=='/rest/v1'||u.hostname==='localhost'||
    /(?:^|\.)(?:localhost|local|internal|test)$/.test(u.hostname)||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||u.hostname.includes(':'))
    throw fail('Database must expose a public HTTPS PostgREST Data API',400);
  return u.origin+'/rest/v1';
}
function validateScopeTarget(input,scopeid){
  validScope(scopeid);
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid Scope database',400);
  const endpoint=safePostgrestUrl(input.endpoint);
  const schema=String(input.schema||'public').trim();
  const table=String(input.table||'').trim();
  const apiKey=String(input.api_key||'');
  if(!TABLE_ID.test(schema)||!TABLE_ID.test(table)||apiKey.length>4096||
    /[\r\n]/.test(apiKey))throw fail('Invalid Scope table or API credential',400);
  return {scopeid,endpoint,schema,table,api_key:apiKey};
}
async function verifyMcpOAuth(request,env){
  const match=/^Bearer ([A-Za-z0-9_.-]{40,8192})$/.exec(request.headers.get('authorization')||'');
  if(!match)throw fail('MCP OAuth token required',401);
  const bits=match[1].split('.');
  if(bits.length!==3)throw fail('Invalid MCP token',401);
  let header,claims;
  try{header=JSON.parse(new TextDecoder().decode(b64bytes(bits[0])));
    claims=JSON.parse(new TextDecoder().decode(b64bytes(bits[1])));}
  catch{throw fail('Invalid MCP token',401)}
  if(header?.alg!=='RS256'||!header.kid||claims?.iss!==env.LOC_CLERK_ISSUER||
    !/^user_[A-Za-z0-9]+$/.test(String(claims.sub||''))||
    !(Array.isArray(claims.aud)?claims.aud.includes(MCP_RESOURCE):claims.aud===MCP_RESOURCE))
    throw fail('MCP token issuer or audience mismatch',401);
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(claims.exp)||claims.exp<=now||
    (claims.nbf!=null&&claims.nbf>now+60)||
    (claims.iat!=null&&claims.iat>now+60))throw fail('MCP token expired',401);
  const key=await clerkPublicKey(env.LOC_CLERK_ISSUER,header.kid);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64bytes(bits[2]),
    new TextEncoder().encode(bits[0]+'.'+bits[1]));
  if(!valid)throw fail('MCP token signature invalid',401);
  return {provider:'clerk',subject:claims.sub};
}
async function mcpJsonBody(request,limit=160000){
  const raw=await request.text();
  if(raw.length>limit)throw fail('MCP payload too large',413);
  try{return JSON.parse(raw)}catch{throw fail('Invalid MCP JSON',400)}
}
const BASE62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newUid(){const bytes=crypto.getRandomValues(new Uint8Array(8));return [...bytes].map(b=>BASE62[b%62]).join('');}
function likePattern(value){
  if(typeof value!=='string'||value.trim().length<2||value.length>100||
    /[\u0000-\u001f\u007f]/.test(value))throw fail('Query must contain 2–100 characters',400);
  return '"*'+value.trim().replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[%_*]/g,'\\$&')+'*"';
}
async function postgrest(profile,options){
  const url=new URL(profile.endpoint+'/'+profile.table);
  const params=options.params||{};
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const headers={accept:'application/json','accept-profile':profile.schema,
    'content-profile':profile.schema,
    apikey:profile.api_key,authorization:'Bearer '+profile.api_key};
  if(options.body){headers['content-type']='application/json';
    headers.prefer='resolution=merge-duplicates,return=minimal';}
  const res=await fetch(url.href,{method:options.body?'POST':'GET',headers,
    ...(options.body?{body:JSON.stringify(options.body)}:{}),
    redirect:'manual',signal:AbortSignal.timeout(options.timeout||9500)});
  if(!res.ok)throw fail('Scope database rejected operation (HTTP '+res.status+')',502);
  return options.body?null:res.json();
}
function escapeScopeValue(value){return 'eq.'+value;}

async function managedMcpInsert(scopeid,row,hasCheckpointUid,oauthToken){
  if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Scope database is not configured',409);
  if(typeof oauthToken!=='string'||!oauthToken.startsWith('eyJ'))throw fail('MCP OAuth authorization required',401);
  const response=await fetch(MANAGED_SUPABASE_EDGE,{
    method:'POST',headers:{apikey:MANAGED_PUBLISHABLE_KEY,
      authorization:'Bearer '+oauthToken,'content-type':'application/json'},
    body:JSON.stringify({kind:'mcp-sync',scopeid,row,update_existing:hasCheckpointUid}),
    signal:AbortSignal.timeout(12000),redirect:'manual'
  });
  if(!response.ok)throw fail('Managed Scope write rejected (HTTP '+response.status+')',
    response.status===401||response.status===403?response.status:502);
  const data=await response.json();
  if(data?.data?.count!==1)throw fail('Managed Scope write was not confirmed',502);
}


// Append is separate from full sync: existing Galaxy metadata must never be overwritten.
async function managedMcpAppend(scopeid,uid,content,batchId,updatedAt,oauthToken){
  if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Scope database is not configured',409);
  const response=await fetch(MANAGED_SUPABASE_EDGE,{
    method:'POST',headers:{apikey:MANAGED_PUBLISHABLE_KEY,
      authorization:'Bearer '+oauthToken,'content-type':'application/json'},
    body:JSON.stringify({kind:'mcp-append',scopeid,uid,content,batch_id:batchId,updated_at:updatedAt}),
    signal:AbortSignal.timeout(12000),redirect:'manual'
  });
  if(!response.ok)throw fail('Managed Scope append rejected (HTTP '+response.status+')',
    response.status===401||response.status===403?response.status:502);
  const result=await response.json();
  if(result?.data?.count!==1)throw fail('Managed Scope append was not confirmed',502);
  return result.data;
}
async function portableMcpAppend(profile,uid,content,batchId,updatedAt){
  const rows=await postgrest(profile,{params:{select:'uid,content,site,title,createtime',
    uid:'eq.'+uid,site:'eq.mcp',limit:1}});
  if(!Array.isArray(rows)||rows.length!==1)throw fail('MCP topic not found',404);
  const original=String(rows[0].content||'');
  const marker='[[GalaxyLinkBatch:'+batchId+']]';
  if(original.includes(marker))return {uid,title:rows[0].title,createtime:rows[0].createtime,duplicate:true};
  const next=original+(original?'\n':'')+content;
  const url=new URL(profile.endpoint+'/'+profile.table);
  url.searchParams.set('uid','eq.'+uid);
  url.searchParams.set('site','eq.mcp');
  const response=await fetch(url.href,{method:'PATCH',headers:{
    'content-type':'application/json','accept-profile':profile.schema,
    'content-profile':profile.schema,apikey:profile.api_key,
    authorization:'Bearer '+profile.api_key,prefer:'return=representation'},
    body:JSON.stringify({content:next,UpdateTime:updatedAt}),
    redirect:'manual',signal:AbortSignal.timeout(9500)});
  if(!response.ok)throw fail('Scope append rejected (HTTP '+response.status+')',502);
  const updated=await response.json();
  if(!Array.isArray(updated)||updated.length!==1)throw fail('Scope append was not confirmed',502);
  return {uid,title:rows[0].title,createtime:rows[0].createtime};
}

async function managedMcpUpdatePr(scopeid,uid,prNumber,title,content,updatedAt,oauthToken){
  if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Scope database is not configured',409);
  if(typeof oauthToken!=='string'||!oauthToken.startsWith('eyJ'))throw fail('MCP OAuth authorization required',401);
  const response=await fetch(MANAGED_SUPABASE_EDGE,{
    method:'POST',headers:{apikey:MANAGED_PUBLISHABLE_KEY,
      authorization:'Bearer '+oauthToken,'content-type':'application/json'},
    body:JSON.stringify({kind:'mcp-update-pr',scopeid,...(uid?{uid}:{}),pr_number:prNumber,title,content,updated_at:updatedAt}),
    signal:AbortSignal.timeout(12000),redirect:'manual'
  });
  if(!response.ok){
    let message='Managed Scope write rejected (HTTP '+response.status+')';
    if(response.status>=400&&response.status<500){
      const data=await response.json().catch(()=>null);
      if(typeof data?.error?.message==='string')message=data.error.message.slice(0,200);
    }
    throw fail(message,[401,403,404].includes(response.status)?response.status:502);
  }
  const data=await response.json();
  if(data?.data?.count!==1)throw fail('Managed Scope write was not confirmed',502);
  const confirmedUid=String(data.data.uid||uid||'');
  if(!UID.test(confirmedUid))throw fail('PR update did not return a valid Galaxy UID',502);
  return confirmedUid;
}

// Direct PostgREST path for self-hosted Scope databases. Reads the existing
// row first so an UPDATE can never be used to create a new article, and
// refuses unless the article is already GitHub PR-origin and its current
// title names the same PR number the caller supplied.
async function postgrestUpdatePr(profile,uid,prNumber,title,content,updatedAt){
  const headers={accept:'application/json','accept-profile':profile.schema,
    'content-profile':profile.schema,
    apikey:profile.api_key,authorization:'Bearer '+profile.api_key};
  const canonical='EsotericVerse/moon-runes-pwa#'+prNumber;
  const prMarker=new RegExp('(?:^|[^0-9])PR\\s*#'+prNumber+'(?:[^0-9]|$)');
  if(!uid){
    // Resolve by source identity; never guess a UID or update multiple rows.
    const exact=await postgrest(profile,{params:{select:'uid,title,site,site_id',
      site:'eq.github',site_id:'eq.'+canonical,limit:2}});
    let matches=exact;
    if(!matches.length){
      const candidates=await postgrest(profile,{params:{select:'uid,title,site,site_id',
        site:'eq.github',title:'ilike.*PR #'+prNumber+'*',
        order:'createtime.desc',limit:40}});
      matches=candidates.filter(row=>prMarker.test(String(row.title||'')));
    }
    if(matches.length!==1)throw fail(matches.length?
      'Multiple PR records found; refusing ambiguous update':'Existing GitHub PR record not found',409);
    uid=matches[0].uid;
    if(!UID.test(uid))throw fail('Invalid saved PR UID',502);
  }
  const getUrl=new URL(profile.endpoint+'/'+profile.table);
  getUrl.searchParams.set('select','uid,title,site,site_id');
  getUrl.searchParams.set('uid','eq.'+uid);
  getUrl.searchParams.set('limit','1');
  const getRes=await fetch(getUrl.href,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(9500)});
  if(!getRes.ok)throw fail('Scope database rejected operation (HTTP '+getRes.status+')',502);
  const rows=await getRes.json();
  if(!Array.isArray(rows)||!rows.length)throw fail('Scope article not found',403);
  const row=rows[0];
  if(row.site!=='github')throw fail('Only GitHub PR-origin articles can be updated through this tool',403);
  if(row.site_id!==canonical&&!prMarker.test(String(row.title||'')))
    throw fail('PR number does not match article provenance',403);
  const patchUrl=new URL(profile.endpoint+'/'+profile.table);
  patchUrl.searchParams.set('uid','eq.'+uid);
  const patchRes=await fetch(patchUrl.href,{method:'PATCH',
    headers:{...headers,'content-type':'application/json',prefer:'return=minimal'},
    body:JSON.stringify({title,content,UpdateTime:updatedAt}),
    redirect:'manual',signal:AbortSignal.timeout(9500)});
  if(!patchRes.ok)throw fail('Scope database rejected operation (HTTP '+patchRes.status+')',502);
  return uid;
}

async function managedMcpRead(scopeid,kind,args,oauthToken){
  if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Managed Scope is not supported',409);
  if(typeof oauthToken!=='string'||!oauthToken.startsWith('eyJ'))
    throw fail('MCP OAuth authorization required',401);
  if(!['mcp-search','mcp-read'].includes(kind))throw fail('Invalid managed read',400);
  const response=await fetch(MANAGED_SUPABASE_EDGE,{
    method:'POST',headers:{apikey:MANAGED_PUBLISHABLE_KEY,
      authorization:'Bearer '+oauthToken,'content-type':'application/json'},
    body:JSON.stringify({kind,scopeid,...args}),
    signal:AbortSignal.timeout(12000),redirect:'manual'
  });
  if(!response.ok)throw fail('Managed Scope read rejected (HTTP '+response.status+')',
    response.status===401||response.status===403?response.status:502);
  const data=await response.json();
  if(!Array.isArray(data?.data))throw fail('Invalid managed Scope read results',502);
  return data.data;
}

export class LocAuthorityState extends DurableObject {
  constructor(ctx,env){super(ctx,env);}
  async listState(){
    const saved=await this.ctx.storage.list({prefix:'target:'});
    const targets=[];
    for(const [key,item] of saved)targets.push({id:key.slice(7),...item.public});
    // Built-in routable providers are managed by the independent Gateway and
    // require no user-entered DB password or modification of the existing Link.
    for(const [id,label] of [['supabase-current','Supabase'],['neon-current','Neon']]){
      if(!targets.some(target=>target.id===id))targets.push({
        id,label,engine:'postgres',managed:true
      });
    }
    targets.sort((a,b)=>a.id.localeCompare(b.id));
    return {primary_id:await this.ctx.storage.get('primary_id')||'supabase-current',targets};
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
    // Runtime currently verifies only the deployed Clerk Session for SQL.
    // This value is intentionally NOT writable via these configuration endpoints.
    return {active:'clerk',providers};
  }
  async putAuthProvider(type,values){
    const previous=await this.ctx.storage.get('auth-provider:'+type);
    const former=previous
      ?await decryptProfile(previous.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
    let profile;
    try{
      profile=validateAuthProviderSettings(type,values,
        {previous:former,siteOrigin:this.env.LOC_CONTROL_ORIGIN});
    }catch(error){throw fail(error.message||'Invalid auth provider settings',400)}
    const publicView=publicAuthProviderSettings(profile);
    await this.ctx.storage.put('auth-provider:'+type,{
      public:publicView,
      encrypted:await encryptProfile(profile,this.env.LOC_CONTROL_ENCRYPTION_KEY)
    });
    return publicView;
  }
  async putTarget(id,input){
    const validated=validateTarget(input,id);
    const old=await this.ctx.storage.get('target:'+id);
    if(!validated.password&&!old)throw fail('New target requires a password');
    const profile=validated.password?validated:{...validated,password:(await decryptProfile(old.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY)).password};
    const {password,...publicFields}=profile;
    await this.ctx.storage.put('target:'+id,{
      public:publicFields,
      encrypted:await encryptProfile(profile,this.env.LOC_CONTROL_ENCRYPTION_KEY)
    });
    return publicFields;
  }
  async selectPrimary(id){
    const builtin=id==='supabase-current'||id==='neon-current';
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
    if(!/^[a-z][a-z0-9_-]{0,31}$/.test(provider)||
      !/^[a-zA-Z0-9_:-]{1,128}$/.test(subject)||
      !/^[a-z][a-z0-9]{0,14}$/.test(scope)||
      !Array.isArray(actions)||!actions.length||actions.length>16||
      actions.some(action=>!['read','write','manage','configure'].includes(action))||
      !Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+366*24*60*60*1000)
      throw fail('Invalid Authority grant');
    const unique=[...new Set(actions)].sort();
    const key=provider+':'+subject+':'+scope;
    await this.ctx.storage.put('grant:'+key,{provider,subject,scope,actions:unique,expires_at:expires});
    return {key,provider,subject,scope,actions:unique,expires_at:expires};
  }
  async revokeGrant(key){
    if(!/^[a-z][a-z0-9_-]{0,31}:[a-zA-Z0-9_:-]{1,128}:[a-z][a-z0-9]{0,14}$/.test(String(key)))
      throw fail('Invalid grant key');
    await this.ctx.storage.delete('grant:'+key);
    return {revoked:true,key};
  }
  // Internal RPC for a trusted SQL gateway. The external provider's JWT must
  // be VERIFIED by the gateway before passing provider + subject here.
  async mayAccess({provider,subject,scope,action}={}){
    if(!['read','write','manage','configure'].includes(action))return false;
    if(!/^[a-z][a-z0-9]{0,14}$/.test(String(scope||'')))return false;
    const key='grant:'+provider+':'+subject+':'+scope;
    const grant=await this.ctx.storage.get(key);
    return Boolean(grant&&grant.expires_at>Date.now()&&grant.actions.includes(action));
  }

  // Secrets are stored only in this pre-existing encrypted Durable Object.
  async putMcpScope(scopeid,input){
    const next=validateScopeTarget(input,scopeid);
    const previous=await this.ctx.storage.get('mcp-scope:'+scopeid);
    if(!next.api_key&&previous)next.api_key=(await decryptProfile(previous.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY)).api_key;
    if(!next.api_key)throw fail('Database API credential is required',400);
    const {api_key,...publicFields}=next;
    await this.ctx.storage.put('mcp-scope:'+scopeid,{
      public:publicFields,encrypted:await encryptProfile(next,this.env.LOC_CONTROL_ENCRYPTION_KEY)});
    return {...publicFields,configured:true};
  }
  async getMcpScope(scopeid){validScope(scopeid);
    const item=await this.ctx.storage.get('mcp-scope:'+scopeid);
    if(item)return {...item.public,configured:true};
    if(Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))return {scopeid,configured:true,
      managed:true,endpoint:'https://qlouywsdiiyiyzpoxyqy.supabase.co/rest/v1',
      schema:'silver',table:MANAGED_SCOPE_TABLES[scopeid]};
    return {scopeid,configured:false};}
  async mcpPrivateProfile(scopeid){
    const item=await this.ctx.storage.get('mcp-scope:'+scopeid);
    return item?decryptProfile(item.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
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
    if(!status.needs_save)return {...status,saved:false,reason:'unchanged'};
    const profile=await this.mcpPrivateProfile(scopeid);
    if(!profile&&!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Scope database is not configured',409);
    if(typeof input.content!=='string'||!input.content.trim()||input.content.length>125000||
      typeof input.title!=='string'||input.title.length>350)
      throw fail('Invalid conversation content or title',400);
    const append=input.append===true;
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
    const useAppend=append&&Boolean(status.saved_at||input.uid);
    if(useAppend){
      const result=profile?
        await portableMcpAppend(profile,uid,input.content,input.batch_id,requestedTime):
        await managedMcpAppend(scopeid,uid,input.content,input.batch_id,requestedTime,oauthToken);
      const saved_at=new Date().toISOString();
      await this.ctx.storage.put(checkpointKey,{updated_at:requestedTime,saved_at,uid});
      return {scopeid,conversation_id,uid,title:result.title||null,
        createtime:result.createtime||null,updated_at:requestedTime,saved_at,saved:true,appended:true};
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
    if(profile){
      // Third-party Scope providers manage their own schema independently.
      await postgrest(profile,{body:row,params:{on_conflict:'uid'}});
    }else await managedMcpInsert(scopeid,row,Boolean(status.uid),oauthToken);
    const saved_at=new Date().toISOString();
    this.mcpSearchCache?.clear();
    await this.ctx.storage.put(checkpointKey,{updated_at:requestedTime,saved_at,uid});
    return {scopeid,conversation_id,updated_at:requestedTime,saved_at,uid,title,createtime:created,saved:true,appended:false};
  }
  // Rewrites an EXISTING article by its stable uid. Unlike mcpSave (which
  // upserts private conversations keyed by conversation_id), this never
  // creates a row: the scoped backend verifies the article is already
  // GitHub PR-origin and that its current title names the same PR number
  // before any write happens.
  async mcpUpdatePr(scopeid,input,oauthToken=''){
    validScope(scopeid);
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Invalid PR update request',400);
    const uid=String(input.uid||'');
    if(uid&&!UID.test(uid))throw fail('Invalid case-sensitive UID',400);
    const prNumber=Number(input.pr_number);
    if(!Number.isInteger(prNumber)||prNumber<1||prNumber>9999999)throw fail('Invalid PR number',400);
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>350||
      typeof input.content!=='string'||!input.content.trim()||input.content.length>125000)
      throw fail('Invalid article title or content',400);
    const requestedTime=validTimestamp(input.updated_at);
    const profile=await this.mcpPrivateProfile(scopeid);
    let resolvedUid=uid;
    if(profile)resolvedUid=await postgrestUpdatePr(profile,uid,prNumber,input.title,input.content,requestedTime);
    else if(Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))
      resolvedUid=await managedMcpUpdatePr(scopeid,uid,prNumber,input.title,input.content,requestedTime,oauthToken);
    else throw fail('Scope database is not configured',409);
    this.mcpSearchCache?.clear();
    return {scopeid,uid:resolvedUid,pr_number:prNumber,updated_at:requestedTime,updated:true};
  }
  async mcpLinkSearch(scopeid,query,limit=5,oauthToken='',source='mcp'){
    if(!['mcp','github'].includes(source))throw fail('Invalid Galaxy source',400);
    validScope(scopeid);
    if(typeof query!=='string'||query.trim().length<2||query.length>100||
      /[\u0000-\u001f\u007f]/.test(query)||!Number.isInteger(limit)||limit<1||limit>5)
      throw fail('Invalid Galaxy Link search',400);
    const profile=await this.mcpPrivateProfile(scopeid);
    let rows;
    if(profile){
      const pattern=likePattern(query);
      rows=await postgrest(profile,{params:{select:'uid,title,createtime',
        site:'eq.'+source,or:'(title.ilike.'+pattern+',content.ilike.'+pattern+')',
        order:'createtime.desc',limit},timeout:4500});
    }else if(Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid)){
      rows=await managedMcpRead(scopeid,'mcp-search',{query,limit,source},oauthToken);
    }else throw fail('Scope database is not configured',409);
    if(!Array.isArray(rows))throw fail('Invalid Galaxy Link search response',502);
    return {scopeid,results:rows.map(r=>({uid:r.uid,title:r.title,createtime:r.createtime}))};
  }
  async mcpSearch(scopeid,query,limit=5,oauthToken=''){
    // Retained internal caller; no unrestricted MCP content search remains.
    return this.mcpLinkSearch(scopeid,query,Math.min(limit,5),oauthToken);
  }
  async mcpRead(scopeid,uid,offset=0,max_chars=20000,oauthToken='',siteFilter=''){
    const onlySite=siteFilter===true?'mcp':(siteFilter||'');
    if(onlySite&&!['mcp','github'].includes(onlySite))throw fail('Invalid article source',400); 
    validScope(scopeid);
    if(!UID.test(uid)||!Number.isInteger(offset)||offset<0||offset>1000000||
      !Number.isInteger(max_chars)||max_chars<1||max_chars>40000)
      throw fail('Invalid article read parameters',400);
    const profile=await this.mcpPrivateProfile(scopeid);
    let rows;
    if(profile){
      rows=await postgrest(profile,{params:{select:'uid,title,content,date,createtime,site,url',
        uid:'eq.'+uid,...(onlySite?{site:'eq.'+onlySite}:{}),limit:1}});
    }else if(Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid)){
      rows=await managedMcpRead(scopeid,'mcp-read',{uid,...(onlySite?{site:onlySite}:{})},oauthToken);
    }else throw fail('Scope database is not configured',409);
    if(!Array.isArray(rows))throw fail('Invalid database response',502);
    if(!rows.length||onlySite&&rows[0].site!==onlySite)return {found:false,scopeid,uid};
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
      grant.provider==='clerk'&&allowed.has(grant.scope)&&grant.expires_at>Date.now());
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
  async mcpGroupSearch(groupid,query,limit=10){
    validScope(groupid);
    const members=await this.mcpGroupMembers(groupid);
    if(!Number.isInteger(limit)||limit<1||limit>20)throw fail('Invalid search limit',400);
    const cacheKey=groupid+':'+limit+':'+likePattern(query);
    this.mcpGroupCache??=new Map();
    const cached=this.mcpGroupCache.get(cacheKey);
    if(cached&&cached.expires>Date.now())return cached.value;
    const task=this.mcpGroupSearchUncached(groupid,query,limit,members);
    this.mcpGroupCache.set(cacheKey,{value:task,expires:Date.now()+15000});
    if(this.mcpGroupCache.size>80)this.mcpGroupCache.delete(this.mcpGroupCache.keys().next().value);
    try{return await task;}catch(error){this.mcpGroupCache.delete(cacheKey);throw error;}
  }
  async mcpGroupSearchUncached(groupid,query,limit,members){
    const results=await Promise.allSettled(members.map(async scopeid=>{
      const scopeStub=this.env.LOC_AUTHORITY_STATE.get(
        this.env.LOC_AUTHORITY_STATE.idFromName('mcp-scope:'+scopeid));
      const profile=await scopeStub.getMcpScope(scopeid);
      if(profile.configured&&!profile.managed)return (await scopeStub.mcpSearch(scopeid,query,limit)).results;
      // Unconfigured built-in Scope: use existing Supabase anonymous RLS.
      if(!['lo3rwang','lrunes'].includes(scopeid))return [];
      const url=new URL('https://qlouywsdiiyiyzpoxyqy.supabase.co/rest/v1/'+scopeid+'_galaxy');
      for(const [key,val] of Object.entries({select:'uid,title,date,createtime',
        search:'eq.true',or:'(title.ilike.'+likePattern(query)+',content.ilike.'+likePattern(query)+')',
        order:'date.desc.nullslast',limit}))url.searchParams.set(key,String(val));
      const res=await fetch(url.href,{headers:{apikey:'sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV',
        'accept-profile':'silver'},signal:AbortSignal.timeout(8500),redirect:'manual'});
      if(!res.ok)throw fail('Public Scope search unavailable',502);
      return (await res.json()).map(row=>({...row,scopeid}));
    }));
    const errors=results.map((r,i)=>r.status==='rejected'?members[i]:null).filter(Boolean);
    const combined=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value)
      .sort((a,b)=>String(b.date||b.createtime||'').localeCompare(String(a.date||a.createtime||''))).slice(0,limit);
    return {groupid,members,results:combined,partial:errors.length>0,failed_scopes:errors};
  }

  async getPrimaryProfileForGateway(){
    const id=await this.ctx.storage.get('primary_id');
    if(!id)return null;
    return this.getProfileForGateway(id);
  }
  // Cloudflare DO RPC: only a separately bound trusted SQL gateway can call this.
  // No HTTP handler exposes the credential or returns decrypted profiles to a browser.
  // Shared, durable quotas for each verified Clerk MCP subject.
  async mcpQuotaAcquire(kind,subject){
    if(!/^clerk:user_[A-Za-z0-9]+$/.test(String(subject||'')))throw fail('Invalid MCP principal',401);
    if(!['read','write','search'].includes(kind))throw fail('Invalid MCP quota kind',400);
    const now=Date.now(),period=60_000,leaseTtl=25_000;
    const maximum=16;
    const outcome=await this.ctx.storage.transaction(async tx=>{
      const cooldownKey='mcp-qos-cooldown:'+subject;
      const blockedUntil=Number(await tx.get(cooldownKey)||0);
      if(blockedUntil>now)return {rejected:'cooldown'};
      const key='mcp-quota-window:'+subject;
      const prior=await tx.get(key);
      const bucket=prior&&now>=prior.started&&now-prior.started<period
        ?prior:{started:now,count:0,reads:0,searches:0,rateRejects:0};
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
          await tx.put(cooldownKey,now+180_000);
          return {rejected:'rate-cooldown'};
        }
        return {rejected:'rate'};
      }
      if(leases.length>=16||(kind!=='write'&&activeReads>=12)||
          (kind==='search'&&activeSearches>=2)){
        // Persist before returning: throwing inside a DO transaction rolls it back.
        await tx.put(cooldownKey,now+180_000);
        return {rejected:'concurrency'};
      }
      const lease=crypto.randomUUID();
      leases.push({lease,subject,kind,expires:now+leaseTtl});
      await tx.put(key,{started:bucket.started,count:bucket.count+1,
        reads:(bucket.reads||0)+(kind==='write'?0:1),
        searches:(bucket.searches||0)+(kind==='search'?1:0)});
      await tx.put('mcp-quota-leases',leases);
      return {lease};
    });
    if(outcome.rejected==='cooldown'||outcome.rejected==='concurrency'||
       outcome.rejected==='rate-cooldown')
      throw fail('MCP request cooldown (3 minutes)',429);
    if(outcome.rejected==='rate')throw fail('MCP request limit exceeded',429);
    return outcome;
  }
  async mcpQuotaRelease(lease,subject){
    if(!/^clerk:user_[A-Za-z0-9]+$/.test(String(subject||'')))throw fail('Invalid MCP principal',401);
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
  async getProfileForGateway(id){
    const stored=await this.ctx.storage.get('target:'+id);
    return stored?decryptProfile(stored.encrypted,this.env.LOC_CONTROL_ENCRYPTION_KEY):null;
  }
}

async function handleMcpAuthority(request,env,url,origin){
  // Authentication precedes all quotas and any downstream SQL access.
  let principal;
  try{principal=await verifyMcpOAuth(request,env);}
  catch(error){
    if(error.status!==401)throw error;
    principal=await verifyIdentityToken(request,env);
  }
  const quota=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName(
    'mcp-quota-global-v1'));
  if(url.pathname==='/v1/mcp/quota'&&request.method==='POST'){
    if(principal.provider!=='clerk')throw fail('MCP OAuth required',401);
    const args=await mcpJsonBody(request,400);
    if(args?.action==='acquire')return json(await quota.mcpQuotaAcquire(args.kind,'clerk:'+principal.subject),200,origin);
    if(args?.action==='release')return json(await quota.mcpQuotaRelease(args.lease,'clerk:'+principal.subject),200,origin);
    throw fail('Invalid MCP quota operation',400);
  }
  // No DB work and no quota spend on retired search endpoints.
  if(/^\/v1\/mcp\/(?:search|group-search)\//.test(url.pathname))
    throw fail('MCP search is disabled',403);
  const kind=/^\/v1\/mcp\/galaxy-link\/search\//.test(url.pathname)?'search':
    request.method==='GET'?'read':'write';
  const ticket=await quota.mcpQuotaAcquire(kind,'clerk:'+principal.subject);
  try{return await handleMcpAuthorityInner(request,env,url,origin,principal);}
  finally{await quota.mcpQuotaRelease(ticket.lease,'clerk:'+principal.subject);}
}
async function handleMcpAuthorityInner(request,env,url,origin,principal){
  const roots=String(env.LOC_RECOVERY_ROOT_CLERK_IDS||'').split(/[\s,;]+/).filter(Boolean);
  const isRoot=roots.includes(principal.subject);
  const stub=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
  const scoped=scope=>env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('mcp-scope:'+scope));
  const allowed=async(scope,action)=>isRoot||await stub.mayAccess({...principal,scope,action});
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
    if(request.method==='PUT'){
      if(!await allowed(scopeid,'configure'))throw fail('Scope configuration denied',403);
      return json(await scoped(scopeid).putMcpScope(scopeid,await mcpJsonBody(request,9000)),200,origin);
    }
  }
  if(['authorize-read','authorize-write'].includes(parts[0])&&
     parts.length===2&&request.method==='GET'){
    const scopeid=validScope(parts[1]),isRead=parts[0]==='authorize-read';
    const source=url.searchParams.get('source')||'mcp';
    if(!['mcp','github'].includes(source)||(source==='github'&&!isRead))
      throw fail('Invalid managed MCP source',400);
    const action=isRead?(source==='github'?'manage':'read'):'write';
    // Managed Kysely uses a trusted root email mapping. Never issue its
    // credentials to a non-root even if that subject can read another Scope.
    if(!isRoot||!await allowed(scopeid,action))
      throw fail('Managed Scope '+action+' denied',403);
    if(!Object.hasOwn(MANAGED_SCOPE_TABLES,scopeid))throw fail('Managed Scope is not supported',404);
    const email=String(env.LOC_ROOT_MANAGEMENT_EMAIL||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw fail('Trusted root email mapping is unavailable',503);
    return json({provider:'clerk',subject:principal.subject,scopeid,email,authorized:true},200,origin);
  }
  if(parts[0]==='checkpoint'&&parts.length===3&&request.method==='GET'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'write'))throw fail('Scope sync denied',403);
    return json(await scoped(scopeid).mcpCheckpoint(scopeid,decodeURIComponent(parts[2]),
      url.searchParams.get('updated_at')||undefined),200,origin);
  }
  if(parts[0]==='sync'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'write'))throw fail('Scope sync denied',403);
    const input=await mcpJsonBody(request);
    if(galaxyLink)input.append=true;
    return json(await scoped(scopeid).mcpSave(scopeid,input,
      (request.headers.get('authorization')||'').replace(/^Bearer /,'')),200,origin);
  }
  if(parts[0]==='update-pr'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    if(!await allowed(scopeid,'manage'))throw fail('PR update requires Scope manager',403);
    return json(await scoped(scopeid).mcpUpdatePr(scopeid,await mcpJsonBody(request),
      (request.headers.get('authorization')||'').replace(/^Bearer /,'')),200,origin);
  }
  if(parts[0]==='search'&&parts.length===2&&request.method==='POST'){
    const scopeid=validScope(parts[1]);
    const args=await mcpJsonBody(request,1600);
    if(!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).some(key=>!['query','limit','source'].includes(key)))
      throw fail('Invalid Galaxy Link search payload',400);
    const source=args.source??'mcp';
    if(!['mcp','github'].includes(source))throw fail('Invalid Galaxy source',400);
    if(!await allowed(scopeid,source==='github'?'manage':'read'))
      throw fail('Scope source search denied',403);
    return json(await scoped(scopeid).mcpLinkSearch(scopeid,args.query,args.limit??5,
      (request.headers.get('authorization')||'').replace(/^Bearer /,''),source),200,origin);
  }
  if(parts[0]==='read'&&parts.length===3&&request.method==='GET'){
    const scopeid=validScope(parts[1]);
    const groupid=url.searchParams.get('groupid')||'';
    const requestedSite=galaxyLink?(url.searchParams.get('site')||'mcp'):
      (url.searchParams.get('site')==='mcp'?'mcp':'');
    if(galaxyLink&&!['mcp','github'].includes(requestedSite))
      throw fail('Invalid Galaxy Link read source',400);
    let permitted=await allowed(scopeid,requestedSite==='github'?'manage':'read');
    if(!permitted&&requestedSite!=='github'&&groupid&&await allowed(validScope(groupid),'read')){
      permitted=(await stub.mcpGroupMembers(groupid)).includes(scopeid);
    }
    if(!permitted)throw fail('Scope article read denied',403);
    const offset=Number(url.searchParams.get('offset')||'0');
    const max_chars=Number(url.searchParams.get('max_chars')||'20000');
    const result=await scoped(scopeid).mcpRead(scopeid,parts[2],offset,max_chars,
      (request.headers.get('authorization')||'').replace(/^Bearer /,''),requestedSite);
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
    return json(await stub.putGrant({provider:'clerk',subject:input?.subject,
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
    if(!/^user_[A-Za-z0-9]+$/.test(String(input?.subject||'')))throw fail('Invalid Clerk subject',400);
    return json(await stub.revokeGrant('clerk:'+input.subject+':'+scopeid),200,origin);
  }
  throw fail('MCP operation not found',404);
}

export default {
  async fetch(request,env){
    let origin='';
    try{
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
      if(url.pathname.startsWith('/v1/mcp/'))return handleMcpAuthority(request,env,url,origin);
      const principal=await verifyIdentityToken(request,env);
      if(!url.pathname.startsWith('/v1/'))throw fail('Not found',404);
      // Identity endpoint is only a verified principal lookup. It grants no
      // data access or management capabilities; the gateway must call mayAccess.
      if(request.method==='GET'&&url.pathname==='/v1/identity')return json(principal,200,origin);
      const roots=String(principal.provider==='clerk'?env.LOC_RECOVERY_ROOT_CLERK_IDS:env.LOC_RECOVERY_ROOT_SECONDARY_SUBJECTS)
        .split(/[\s,;]+/).filter(Boolean);
      if(!roots.includes(principal.subject))throw fail('Recovery administrator required',403);
      const stub=env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
      if(request.method==='GET'&&url.pathname==='/v1/me')return json(principal,200,origin);
      if(request.method==='GET'&&url.pathname==='/v1/state')return json(await stub.listState(),200,origin);
      if(request.method==='GET'&&url.pathname==='/v1/auth/providers')
        return json(await stub.listAuthProviders(),200,origin);
      const authMatch=new RegExp('^/v1/auth/providers/(github|oidc|entra|ldap|ad|neon)$').exec(url.pathname);
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
        // Preference is persisted here. The current LOC app still uses its
        // existing deployed routing until a trusted SQL Gateway is connected.
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
