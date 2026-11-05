import {authorityAction} from './authority-client.mjs';
import {readMemory} from './galaxy-read.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
const PUBLIC_SCOPE_IDS=Object.freeze(SCOPE_ROUTE_INDEX.filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)));
// LOC MCP HTTP entry point. No database write is granted by an OAuth login.
export const MCP_RESOURCE=(globalThis.process?.env?.LOC_MCP_RESOURCE_URL||'https://loc.lo3rwang.cc/mcp').replace(/\/+$/,'');
export const CLERK_ISSUER=(globalThis.process?.env?.LOC_CLERK_ISSUER||'https://precise-grackle-3371.clerk.accounts.dev').replace(/\/+$/,'');
export function mcpConfig(env={}){
  return {resource:String(env.LOC_MCP_RESOURCE_URL||MCP_RESOURCE).replace(/\/+$/,''),
    issuer:String(env.LOC_CLERK_ISSUER||CLERK_ISSUER).replace(/\/+$/,'')};
}
const SCOPES=['profile','email'];
const DEFAULT_PROTOCOL='2025-06-18';
const SUPPORTED_PROTOCOLS=new Set(['2025-03-26','2025-06-18','2025-11-25']);
const COMMON_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Expose-Headers':'WWW-Authenticate, MCP-Session-Id'};

function response(body,status=200,extra={}){
  return new Response(body==null?null:JSON.stringify(body),{
    status,headers:{...COMMON_HEADERS,...(body==null?{}:{'Content-Type':'application/json; charset=utf-8'}),...extra}
  });
}
export function preflight(){return response(null,204);}
export function protectedResourceMetadata(env={}){
  const {resource,issuer}=mcpConfig(env);
  return response({resource,authorization_servers:[issuer],
    bearer_methods_supported:['header'],scopes_supported:SCOPES});
}
function unauthorized(config){
  const resourceMetadata=config.resource.replace(/\/mcp$/,'')+'/.well-known/oauth-protected-resource/mcp';
  return response({error:'unauthorized',error_description:'Clerk OAuth access token required'},401,{
    'WWW-Authenticate':'Bearer resource_metadata="'+resourceMetadata+'", scope="'+SCOPES.join(' ')+'"'
  });
}
function base64url(text){
  const normalized=text.replace(/-/g,'+').replace(/_/g,'/');
  const bin=atob(normalized);
  return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
function decodeJson(text){return JSON.parse(new TextDecoder().decode(base64url(text)));}
// JWKS is PUBLIC verification metadata, never a user Session or OAuth grant.
// Share in-flight fetch per issuer and reuse public keys up to five minutes
// across isolates when the Cloudflare edge Cache API is available.
const jwksCache=new Map();
const jwksPending=new Map();
async function loadKeys(issuer){
  const url=issuer+'/.well-known/jwks.json';
  const edge=globalThis.caches?.default;
  const cacheRequest=new Request(url,{headers:{accept:'application/json'}});
  let response=edge?await edge.match(cacheRequest).catch(()=>null):null;
  const fromEdge=Boolean(response);
  if(!response){
    response=await fetch(url,{headers:{accept:'application/json'},
      signal:AbortSignal.timeout(6500)});
  }
  if(!response.ok)throw new Error('Clerk JWKS unavailable');
  const text=await response.text();
  if(text.length>120000)throw new Error('Clerk JWKS response too large');
  let data;
  try{data=JSON.parse(text);}catch{throw new Error('Invalid Clerk JWKS');}
  if(!Array.isArray(data?.keys))throw new Error('Invalid Clerk JWKS');
  if(!fromEdge&&edge){
    const headers=new Headers({'content-type':'application/json',
      'cache-control':'public, max-age=300'});
    await edge.put(cacheRequest,new Response(text,{status:200,headers})).catch(()=>{});
  }
  jwksCache.set(issuer,{keys:data.keys,expiry:Date.now()+300000});
  if(jwksCache.size>16)jwksCache.delete(jwksCache.keys().next().value);
  return data.keys;
}
async function getKeys(issuer){
  const cached=jwksCache.get(issuer);
  if(cached&&cached.expiry>Date.now())return cached.keys;
  const ongoing=jwksPending.get(issuer);
  if(ongoing)return ongoing;
  const pending=loadKeys(issuer);
  jwksPending.set(issuer,pending);
  try{return await pending;}
  finally{if(jwksPending.get(issuer)===pending)jwksPending.delete(issuer);}
}
// Only signed, non-expired OAuth JWTs explicitly bound to this MCP resource are accepted.
// Session JWTs, arbitrary bearer strings and tokens for other audiences are never accepted.
async function verifyOAuthToken(token,config){
  const parts=token.split('.');
  if(parts.length!==3) return null; // Clerk opaque tokens require separate server-side verification.
  const header=decodeJson(parts[0]);
  const claims=decodeJson(parts[1]);
  if(header?.alg!=='RS256'||!header?.kid||claims?.iss!==config.issuer||
    !/^user_[A-Za-z0-9]+$/.test(String(claims.sub||'')))return null;
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(claims.exp)||claims.exp<=now||
    (claims.nbf!=null&&(!Number.isFinite(claims.nbf)||claims.nbf>now+60))||
    (claims.iat!=null&&(!Number.isFinite(claims.iat)||claims.iat>now+60)))return null;
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!audiences.includes(config.resource))return null;
  const keys=await getKeys(config.issuer);
  const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&
    (!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!jwk)return null;
  const key=await crypto.subtle.importKey('jwk',jwk,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const good=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64url(parts[2]),
    new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!good)return null;
  return {subject:claims.sub,scopes:String(claims.scope||'').split(/\s+/).filter(Boolean)};
}
function result(id,value){return response({jsonrpc:'2.0',id,result:value});}
function rpcError(id,code,message,httpStatus=200){
  return response({jsonrpc:'2.0',id,error:{code,message}},httpStatus);
}
const TOOLS=[
  {name:'loc_connection_status',description:'Check LOC MCP and Clerk OAuth connectivity (read only).',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'read_memory',description:'Read a PUBLIC LOC Galaxy article by exact, case-sensitive UID; supports content paging with offset/max_chars.',
    inputSchema:{type:'object',properties:{
      uid:{type:'string',pattern:'^[A-Za-z0-9]{8}$',description:'Exact Galaxy article UID'},
      scopeid:{type:'string',enum:PUBLIC_SCOPE_IDS},
      offset:{type:'integer',minimum:0,maximum:1000000},
      max_chars:{type:'integer',minimum:1,maximum:40000}
    },required:['uid'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}}
,
  {name:'scope_storage',description:'View or change authorized Scope database endpoint and existing table. Enter provider credentials only through secure LOC Clerk UI/Authority endpoint, never in chat.',
    inputSchema:{type:'object',properties:{
      scopeid:{type:'string'},endpoint:{type:'string',description:'HTTPS PostgREST URL ending /rest/v1; omit to view'},
      schema:{type:'string'},table:{type:'string',description:'Existing Galaxy-compatible table; LOC never creates tables'}
    },required:['scopeid'],additionalProperties:false}},
  {name:'galaxy_link',description:'Scope-authorized Galaxy Link: MCP conversation resume plus private GitHub PR records. GitHub source requires Scope manage permission; source text is never scraped.',
    inputSchema:{type:'object',properties:{
      action:{type:'string',enum:['search','read','check','record','update_pr']},
      scopeid:{type:'string'},uid:{type:'string',pattern:'^[A-Za-z0-9]{8}$',description:'Optional for update_pr: omit to locate existing GitHub PR by pr_number; never needed from the user'},
      query:{type:'string',minLength:2,maxLength:100},limit:{type:'integer',minimum:1,maximum:5},
      conversation_id:{type:'string'},updated_at:{type:'string'},created_at:{type:'string'},
      records:{type:'array',minItems:1,maxItems:100,items:{type:'object',properties:{
        role:{type:'string',enum:['user','assistant']},kind:{type:'string',enum:['original','advice']},
        sent_at:{type:'string'},text:{type:'string'},message_id:{type:'string'}
      },required:['role','kind','sent_at','text','message_id'],additionalProperties:false}},
      title:{type:'string',maxLength:350},content:{type:'string',maxLength:125000},
      pr_number:{type:'integer',minimum:1,description:'Existing GitHub PR number; update_pr resolves unique Galaxy UID after Scope manage authorization'},
      offset:{type:'integer',minimum:0},max_chars:{type:'integer',minimum:1,maximum:40000}
    },required:['action','scopeid'],additionalProperties:false}},
  {name:'join_scope_group',description:'Group manager attaches an existing Scope; does not move or copy data.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'}},
      required:['groupid','scopeid'],additionalProperties:false}},
  {name:'grant_scope_access',description:'Only a Scope Group manager may grant Clerk subjects read/write/configure/manage rights to the Group or a member Scope.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'},
      subject:{type:'string',description:'Verified Clerk user_... identifier'},
      actions:{type:'array',items:{type:'string',enum:['read','write','manage','configure']}},
      days:{type:'integer',minimum:1,maximum:365}},
      required:['groupid','scopeid','subject','actions'],additionalProperties:false}},
  {name:'revoke_scope_access',description:'Scope Group manager immediately revokes one member’s Clerk access to a Group or member Scope.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'},
      subject:{type:'string',description:'Clerk user_... identifier'}},
      required:['groupid','scopeid','subject'],additionalProperties:false}},
];
function toolResponse(id,value){return result(id,{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});}
// The public UID reader also uses the global Authority Durable Object quota.
async function withMcpQuota(token,env,action){
  const authority=new URL(String(env.LOC_MCP_AUTHORITY_URL||
    'https://auth.lo3rwang.cc'));
  if(authority.protocol!=='https:'||authority.username||authority.password||
    authority.search||authority.hash||!['','/'].includes(authority.pathname))
    throw Error('Invalid LOC Authority origin');
  const endpoint=new URL('/v1/mcp/quota',authority.origin);
  const request=async payload=>{
    const res=await fetch(endpoint.href,{
      method:'POST',headers:{authorization:'Bearer '+token,
        origin:'https://loc.lo3rwang.cc','content-type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(12000),
      redirect:'error',cache:'no-store'
    });
    if(!res.ok){
      const err=new Error(res.status===429?'MCP request limit exceeded':'MCP quota unavailable');
      err.httpStatus=res.status;throw err;
    }
    return res.json();
  };
  const permit=await request({action:'acquire',kind:'read'});
  try{return await action();}
  finally{await request({action:'release',lease:permit.lease});}
}
export async function handleMcp(request,env={}){
  const config=mcpConfig(env);
  if(request.method==='OPTIONS')return preflight();
  if(!['GET','POST'].includes(request.method))return response({error:'method_not_allowed'},405,{Allow:'GET, POST, OPTIONS'});
  const match=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
  if(!match)return unauthorized(config);
  let identity=null;
  try{identity=await verifyOAuthToken(match[1],config);}catch{return unauthorized(config);}
  if(!identity)return unauthorized(config);
  if(request.method==='GET')return response({error:'SSE_not_supported',message:'Use Streamable HTTP POST'},405,{Allow:'POST, OPTIONS'});
  let payload;
  try{payload=await request.json();}catch{return rpcError(null,-32700,'Invalid JSON',400);}
  if(!payload||Array.isArray(payload)||payload.jsonrpc!=='2.0'||typeof payload.method!=='string')
    return rpcError(payload?.id??null,-32600,'Invalid JSON-RPC request',400);
  if(payload.id==null)return response(null,202); // JSON-RPC notifications have no reply.
  switch(payload.method){
    case 'initialize':{
      const proposed=payload.params?.protocolVersion;
      return result(payload.id,{protocolVersion:SUPPORTED_PROTOCOLS.has(proposed)?proposed:DEFAULT_PROTOCOL,
        capabilities:{tools:{listChanged:false}},serverInfo:{name:'loc-mcp',version:'0.2.0',
           ...(proposed==='2025-11-25'?{icons:[{src:'https://loc.lo3rwang.cc/assets/site/icons/loc-favicon.png',mimeType:'image/png'}]}:{})},
        instructions:'Public search/read use existing Galaxy RLS. Private Scope read, write and Group search are independently authorized by Clerk + LOC Authority. galaxy_link separates private MCP conversations from manager-only GitHub PR records; recording requires supplied source text.'});
    }
    case 'ping':return result(payload.id,{});
    case 'tools/list':return result(payload.id,{tools:TOOLS});
    case 'tools/call':{
      const name=payload.params?.name;
      const args=payload.params?.arguments??{};
      if(!TOOLS.some(tool=>tool.name===name))return rpcError(payload.id,-32602,'Unknown tool');
      if(!args||typeof args!=='object'||Array.isArray(args))
        return rpcError(payload.id,-32602,'Tool arguments must be an object');
      if(name==='loc_connection_status')return toolResponse(payload.id,{
        connected:true,provider:'clerk',subject:identity.subject,
        resource:config.resource,galaxyPublicReadEnabled:true,
        galaxyWriteSupported:true,writeRequiresScopeAuthorization:true,
        availableTools:TOOLS.map(tool=>tool.name)});
      try{
        const value=name==='read_memory'?
          await withMcpQuota(match[1],env,()=>readMemory(args,env)):
          await authorityAction(name,args,match[1],env);
        return toolResponse(payload.id,value);
      }catch(error){
        const validation=error?.code==='INVALID_ARGUMENT';
        return result(payload.id,{isError:true,content:[{type:'text',
          text:validation?error.message:
            error?.httpStatus&&error.httpStatus<500?error.message:
            'LOC data service unavailable; please retry later.'}]});
      }
    }
    default:return rpcError(payload.id,-32601,'Method not found');
  }
}
