import {authorityAction} from './authority-client.mjs';
import {searchMemory,readMemory} from './galaxy-read.mjs';
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
const jwksCache=new Map();
async function getKeys(issuer){
  const cached=jwksCache.get(issuer);
  if(cached&&cached.expiry>Date.now())return cached.keys;
  const r=await fetch(issuer+'/.well-known/jwks.json',
    {headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(6500)});
  if(!r.ok)throw new Error('Clerk JWKS unavailable');
  const data=await r.json();
  if(!Array.isArray(data?.keys))throw new Error('Invalid Clerk JWKS');
  jwksCache.set(issuer,{keys:data.keys,expiry:Date.now()+300000});
  return data.keys;
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
  {name:'search_memory',description:'Search PUBLIC LOC Galaxy articles in title or content, e.g. LP26. No private messages or administrator-only results. Returns article UIDs for read_memory.',
    inputSchema:{type:'object',properties:{
      query:{type:'string',minLength:2,maxLength:100,description:'Text to search in title and content'},
      scopeid:{type:'string',enum:PUBLIC_SCOPE_IDS,description:'Select one public LOC Scope; group aggregation requires separate authorization'},
      limit:{type:'integer',minimum:1,maximum:20},
      offset:{type:'integer',minimum:0,maximum:500}
    },required:['query'],additionalProperties:false},
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
  {name:'check_conversation',description:'Compare source updated_at to last successfully saved_at (no database scan or write).',
    inputSchema:{type:'object',properties:{scopeid:{type:'string'},conversation_id:{type:'string'},
      updated_at:{type:'string',description:'Actual source last-updated ISO time'}},
      required:['scopeid','conversation_id','updated_at'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'sync_conversation',description:'Save a supplied updated conversation into its authorized Scope table; unchanged versions are skipped. Requires real source transcript.',
    inputSchema:{type:'object',properties:{scopeid:{type:'string'},conversation_id:{type:'string'},
      updated_at:{type:'string'},created_at:{type:'string'},title:{type:'string'},
      content:{type:'string',maxLength:125000}},required:['scopeid','conversation_id','updated_at','content'],
      additionalProperties:false}},
  {name:'update_scope_pr',description:'Rewrite an EXISTING Galaxy article by exact uid. Never creates a new article: the article must already be GitHub PR-origin (site=github) and its current title must name the same pr_number, or the update is refused.',
    inputSchema:{type:'object',properties:{
      scopeid:{type:'string'},uid:{type:'string',pattern:'^[A-Za-z0-9]{8}$',description:'Exact Galaxy article UID to rewrite'},
      pr_number:{type:'integer',minimum:1,description:'Must match a "PR #<pr_number>" marker already present in the article title'},
      title:{type:'string',maxLength:350},content:{type:'string',maxLength:125000},
      updated_at:{type:'string'}
    },required:['scopeid','uid','pr_number','title','content','updated_at'],additionalProperties:false}},
  {name:'search_scope',description:'Search the authenticated Scope’s OWN private title/content; uses its configured database.',
    inputSchema:{type:'object',properties:{scopeid:{type:'string'},query:{type:'string'},
      limit:{type:'integer',minimum:1,maximum:20}},required:['scopeid','query'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'read_scope',description:'Read an authorized Scope article by exact UID; groupid permits group-authorized reads.',
    inputSchema:{type:'object',properties:{scopeid:{type:'string'},uid:{type:'string'},
      groupid:{type:'string'},offset:{type:'integer'},max_chars:{type:'integer'}},
      required:['scopeid','uid'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'search_group',description:'Search multiple member Scopes only after Scope Group read authorization; labels each result with scopeid.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},query:{type:'string'},
      limit:{type:'integer',minimum:1,maximum:20}},required:['groupid','query'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
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
        capabilities:{tools:{listChanged:false}},serverInfo:{name:'loc-mcp',version:'0.2.0'},
        instructions:'Public search/read use existing Galaxy RLS. Private Scope read, write and Group search are independently authorized by Clerk + LOC Authority. sync_conversation only processes supplied source content.'});
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
        const value=(name==='search_memory'||name==='read_memory')?
          (name==='search_memory'?await searchMemory(args,env):await readMemory(args,env)):
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
