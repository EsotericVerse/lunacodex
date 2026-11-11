import {jwtVerify,createRemoteJWKSet} from 'jose';
import {authorityAction} from './authority-client.mjs';
import {readMemory} from './galaxy-read.mjs';
import {privateGalaxyLink} from './private-galaxy.mjs';
import {mcpDatabaseConfiguration} from './native-kysely.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
const PUBLIC_SCOPE_IDS=Object.freeze(SCOPE_ROUTE_INDEX.filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)));
// LOC MCP HTTP entry point. No database write is granted by an OAuth login.
export const MCP_RESOURCE=(globalThis.process?.env?.LOC_MCP_RESOURCE_URL||'https://mcp.lo3rwang.cc').replace(/\/+$/,'');
export const LOC_OAUTH_ISSUER='https://auth.lo3rwang.cc/api/auth';
export function mcpConfig(env={}){
  return {resource:String(env.LOC_MCP_RESOURCE_URL||MCP_RESOURCE).replace(/\/+$/,''),
    issuer:LOC_OAUTH_ISSUER};
}
const PR_SEARCH_WARNING='請至github頁面找尋PR相關資料！不開放搜尋PR!';
const SEARCH_PERMISSION_WARNING='只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。';
const SCOPES=['openid','profile','email','offline_access'];
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
  const resourceMetadata=config.resource+'/.well-known/oauth-protected-resource';
  return response({error:'unauthorized',error_description:'LOC OAuth access token required'},401,{
    'WWW-Authenticate':'Bearer resource_metadata="'+resourceMetadata+'", scope="'+SCOPES.join(' ')+'"'
  });
}
// Auth protocol is delegated to Better Auth. The standard JOSE implementation
// checks RFC 9068 resource JWTs; there is no custom JWT decoder or signer.
const jwks=createRemoteJWKSet(new URL('https://auth.lo3rwang.cc/api/auth/jwks'));
async function verifyOAuthToken(token,config){
  try{
    const {payload}=await jwtVerify(token,jwks,{
      issuer:config.issuer,audience:config.resource,typ:'at+jwt'
    });
    if(typeof payload.sub!=='string'||!payload.sub)return null;
    return {subject:payload.sub,scopes:String(payload.scope||'')
      .split(/\s+/).filter(Boolean)};
  }catch{return null}
}
function result(id,value){return response({jsonrpc:'2.0',id,result:value});}
function rpcError(id,code,message,httpStatus=200){
  return response({jsonrpc:'2.0',id,error:{code,message}},httpStatus);
}
const TOOLS=[
  {name:'loc_connection_status',description:'Check LOC MCP and LOC OAuth connectivity (read only).',
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
  {name:'scope_storage',description:'Read the LOC Auth Scope connection status. Scope database URL registration has been retired; database selection is managed by the LOC business backend.',
    inputSchema:{type:'object',properties:{
      scopeid:{type:'string'}
    },required:['scopeid'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'galaxy_link',description:'Galaxy conversation continuity. Search ONLY when the human user explicitly requests a conversation search; never search automatically. PR/GitHub search is forbidden: 請至github頁面找尋PR相關資料！不開放搜尋PR! QoS warns before the limit and enforces a five-minute search interval.',
    inputSchema:{type:'object',properties:{
      action:{type:'string',enum:['search','read','check','record']},
      scopeid:{type:'string'},uid:{type:'string',pattern:'^[A-Za-z0-9]{8}$',description:'Known exact Galaxy UID for recorded conversation read'},
      query:{type:'string',minLength:2,maxLength:100},limit:{type:'integer',minimum:1,maximum:5},
      user_requested:{type:'boolean',description:'True only when the human user explicitly asked to search these conversations. Do not set for autonomous context lookup.'},
      conversation_id:{type:'string'},updated_at:{type:'string'},created_at:{type:'string'},
      records:{type:'array',minItems:1,maxItems:100,items:{type:'object',properties:{
        role:{type:'string',enum:['user','assistant']},kind:{type:'string',enum:['original','advice']},
        sent_at:{type:'string'},text:{type:'string'},message_id:{type:'string'}
      },required:['role','kind','sent_at','text','message_id'],additionalProperties:false}},
      title:{type:'string',maxLength:350},content:{type:'string',maxLength:125000},
      offset:{type:'integer',minimum:0},max_chars:{type:'integer',minimum:1,maximum:40000}
    },required:['action','scopeid'],additionalProperties:false}},
  {name:'join_scope_group',description:'Group manager attaches an existing Scope; does not move or copy data.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'}},
      required:['groupid','scopeid'],additionalProperties:false}},
  {name:'grant_scope_access',description:'Only a Scope Group manager may grant LOC subjects read/write/configure/manage rights to the Group or a member Scope.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'},
      subject:{type:'string',description:'Verified loc_... identity subject'},
      actions:{type:'array',items:{type:'string',enum:['read','write','manage','configure']}},
      days:{type:'integer',minimum:1,maximum:365}},
      required:['groupid','scopeid','subject','actions'],additionalProperties:false}},
  {name:'revoke_scope_access',description:'Scope Group manager immediately revokes one member’s LOC access to a Group or member Scope.',
    inputSchema:{type:'object',properties:{groupid:{type:'string'},scopeid:{type:'string'},
      subject:{type:'string',description:'Verified loc_... identity subject'}},
      required:['groupid','scopeid','subject'],additionalProperties:false}},
];
function toolResponse(id,value){
 const warning=typeof value?.warning==='string'?value.warning:'';
 return result(id,{content:[{type:'text',text:(warning?warning+'\n':'')+JSON.stringify(value)}],
   structuredContent:value});
}
// The public UID reader also uses the global Authority Durable Object quota.
// Data QoS is owned by the data server. LOC Auth is not a quota service.
async function withMcpQuota(token,env,action){
  return action();
}
async function qosWarningForDeniedPr(){
  return '';
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
        instructions:'Public Galaxy reads use direct Kysely visibility filters. Private Galaxy read/search use direct Kysely after LOC Auth Scope authorization. Private writes require an independent LOC Auth Scope grant and a configured native Kysely backend. loc_connection_status reports configuration only, not successful database read/write. galaxy_link.search is permitted only by explicit human user request and user_requested=true. 請至github頁面找尋PR相關資料！不開放搜尋PR! QoS warns before the next request reaches a limit; searches have a five-minute gate.'});
    }
    case 'ping':return result(payload.id,{});
    case 'tools/list':return result(payload.id,{tools:TOOLS});
    case 'tools/call':{
      const name=payload.params?.name;
      const args=payload.params?.arguments??{};
      if(!TOOLS.some(tool=>tool.name===name))return rpcError(payload.id,-32602,'Unknown tool');
      if(!args||typeof args!=='object'||Array.isArray(args))
        return rpcError(payload.id,-32602,'Tool arguments must be an object');
      if(name==='galaxy_link'&&args.action==='search'&&
        /(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(String(args.query||''))){
        const near=await qosWarningForDeniedPr(match[1],env);
        return result(payload.id,{isError:true,content:[{type:'text',
          text:PR_SEARCH_WARNING+(near?'\n'+near:'')}]});
      }
      if(name==='galaxy_link'&&args.action==='search'&&args.user_requested!==true)
        return result(payload.id,{isError:true,content:[{type:'text',
          text:SEARCH_PERMISSION_WARNING}]});
      if(name==='galaxy_link'&&args.action==='update_pr')
        return result(payload.id,{isError:true,content:[{type:'text',
          text:PR_SEARCH_WARNING}]});
      if(name==='loc_connection_status')return toolResponse(payload.id,{
        connected:true,provider:'loc',subject:identity.subject,
        resource:config.resource,galaxyPublicReadEnabled:true,
        galaxyWriteSupported:true,writeRequiresScopeAuthorization:true,
        nativeDatabase:mcpDatabaseConfiguration(env),
        availableTools:TOOLS.map(tool=>tool.name)});
      try{
        const directPrivate=name==='galaxy_link'&&['read','search'].includes(args.action);
        const value=name==='read_memory'?
          await withMcpQuota(match[1],env,()=>readMemory(args,env)):
          directPrivate?await withMcpQuota(match[1],env,
            ()=>privateGalaxyLink(args,match[1],identity.subject,env),
            args.action==='search'?'search':'read'):
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
