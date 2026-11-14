import {verifyAccessTokenRequest,requestToResourceInput} from 'better-auth/oauth2';
import {businessAction} from './business-actions.mjs';
import {authorizeMcpBearer} from './access-roles.mjs';
import {providerStatuses,requestTool,approvalReceipt} from './upstream-policy.mjs';
import {listUpstreamTools} from './upstream-tools.mjs';
import {readMemory} from './galaxy-read.mjs';
import {articleDistribution} from './article-distribution.mjs';
import {privateGalaxyLink} from './private-galaxy.mjs';
import {mcpDatabaseConfiguration} from './native-kysely.mjs';
import {mcpToolJsonSchema,parseMcpToolArgs,McpRpcSchema} from './tool-contracts.mjs';
import {handleStatelessMcpPost,streamMcpSseResponse} from './stateless-transport.mjs';
// LOC MCP HTTP entry point. No database write is granted by an OAuth login.
export const MCP_RESOURCE=(globalThis.process?.env?.LOC_MCP_RESOURCE_URL||'https://mcp.lo3rwang.cc').replace(/\/+$/,'');
export const LOC_OAUTH_ISSUER='https://auth.lo3rwang.cc/api/auth';
export function mcpConfig(env={}){
  return {resource:String(env.LOC_MCP_RESOURCE_URL||MCP_RESOURCE).replace(/\/+$/,''),
    issuer:LOC_OAUTH_ISSUER};
}
const PR_SEARCH_WARNING='請至github頁面找尋PR相關資料！不開放搜尋PR!';
const SEARCH_PERMISSION_WARNING='只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。';
const SCOPES=['openid','profile','email','offline_access','loc:import'];
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
function oauthChallenge(config){
  return 'Bearer resource_metadata="'+
    config.resource+'/.well-known/oauth-protected-resource", scope="openid"';
}
function unauthorized(config){
  return response({error:'unauthorized',error_description:'LOC OAuth access token required'},401,{
    'WWW-Authenticate':oauthChallenge(config)
  });
}
// LOC MCP is an independent OAuth resource server, not a Better Auth subsystem.
// Here it uses Better Auth's standards-based JOSE helper only to verify
// LOC Auth-issued RFC 9068 tokens; MCP tools and business policy remain separate.
export async function verifyOAuthToken(request,config){
  try{
    const payload=await verifyAccessTokenRequest(requestToResourceInput(request),{
      jwksUrl:'https://auth.lo3rwang.cc/api/auth/jwks',
      verifyOptions:{issuer:config.issuer,audience:config.resource,
        typ:'at+jwt',requiredClaims:['azp']},
      requiredScopes:['openid']
    });
    if(typeof payload.sub!=='string'||!payload.sub)return null;
    return {subject:payload.sub,scopes:String(payload.scope||'')
      .split(/\s+/).filter(Boolean)};
  }catch{return null}
}
function result(id,value){return response({jsonrpc:'2.0',id,result:value});}
function rpcError(id,code,message,httpStatus=200,headers={}){
  return response({jsonrpc:'2.0',id,error:{code,message}},httpStatus,headers);
}
const TOOLS=[
  {name:'loc_connection_status',description:'Check LOC MCP and LOC OAuth connectivity (read only).',
    inputSchema:mcpToolJsonSchema('loc_connection_status'),
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'read_memory',description:'Read a PUBLIC LOC Galaxy article by exact, case-sensitive UID; supports content paging with offset/max_chars.',
    inputSchema:mcpToolJsonSchema('read_memory'),
    annotations:{readOnlyHint:true,destructiveHint:false}}
,
  {name:'scope_storage',description:'Read the LOC business Scope status. Scope database URL registration has been retired; database selection is managed by the LOC business backend.',
    inputSchema:mcpToolJsonSchema('scope_storage'),
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'galaxy_link',description:'Galaxy conversation continuity. Search ONLY when the human user explicitly requests a conversation search; never search automatically. PR/GitHub search is forbidden: 請至github頁面找尋PR相關資料！不開放搜尋PR! The business data service handles authorization and persistence.',
    inputSchema:mcpToolJsonSchema('galaxy_link')},
  {name:'article_distribution',description:'Get monthly published LOC article-count statistics for a calendar year or rolling 12 months. No SQL or article text; chart-ready numbers.',
    inputSchema:mcpToolJsonSchema('article_distribution'),
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'provider_list',description:'List LOC user-linked upstream MCP providers and their function policies (no credentials).',
    inputSchema:mcpToolJsonSchema('provider_list'),
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'provider_tools',description:'Discover tools offered by one already-authorized upstream MCP provider. This does not grant permission to call them.',
    inputSchema:mcpToolJsonSchema('provider_tools'),
    annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'provider_call',description:'Execute a provider MCP function only if LOC policy is auto; ask queues an explicit human approval, deny blocks the call.',
    inputSchema:mcpToolJsonSchema('provider_call')},
  {name:'provider_receipt',description:'Read the result of an explicitly approved upstream MCP operation using its receipt ID.',
    inputSchema:mcpToolJsonSchema('provider_receipt'),
    annotations:{readOnlyHint:true,destructiveHint:false}},

];
function toolResponse(id,value){
 const warning=typeof value?.warning==='string'?value.warning:'';
 return result(id,{content:[{type:'text',text:(warning?warning+'\n':'')+JSON.stringify(value)}],
   structuredContent:value});
}
// LOC MCP business operations are independent of Auth-owned rate counters.
export async function handleMcp(request,env={}){
  const config=mcpConfig(env);
  if(request.method==='OPTIONS')return preflight();
  if(!['GET','POST'].includes(request.method))return response({error:'method_not_allowed'},405,{Allow:'GET, POST, OPTIONS'});
  const match=/^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'');
  if(!match)return unauthorized(config);
  let identity=null;
  try{identity=await verifyOAuthToken(request,config);}catch{return unauthorized(config);}
  if(!identity)return unauthorized(config);
  if(request.method==='GET')return response({error:'SSE_not_supported',message:'Use Streamable HTTP POST'},405,{Allow:'POST, OPTIONS'});
  return handleStatelessMcpPost(request,async payload=>{
    // JSON remains the default for lightweight handshake/list requests.
    // An MCP tool call can stream its JSON-RPC response over this same POST
    // when the client advertises text/event-stream (including Accept: both).
    const stream=payload.method==='tools/call'&&
      /(?:^|[,\\s])text\\/event-stream(?:[,;\\s]|$)/i.test(request.headers.get('accept')||'');
    if(stream){
      // Authorize before opening the 200 SSE response so 401/403/429/503
      // retain their original HTTP status and WWW-Authenticate semantics.
      try{await authorizeMcpBearer(match[1],identity.subject,env);}
      catch(error){return mcpRoleFailure(payload.id,error,config);}
      return streamMcpSseResponse(()=>
        dispatchMcpPayload(payload,identity,match[1],config,env,true));
    }
    return dispatchMcpPayload(payload,identity,match[1],config,env);
  });
}
function mcpRoleFailure(id,error,config){
  const status=[401,403,429].includes(error?.httpStatus)?error.httpStatus:503;
  return rpcError(id,-32001,status===403?'LOC MCP role not granted':
    status===401?'Verified LOC OAuth identity required':
    status===429?'LOC OAuth UserInfo rate limited':
    'LOC MCP role service unavailable',status,
    status===401?{'WWW-Authenticate':oauthChallenge(config)}:{});
}
async function dispatchMcpPayload(payload,identity,bearer,config,env,roleVerified=false){
  // A valid SSO token identifies a user, but does not grant MCP capacity.
  // api.manage is the sole existing role registry; no MCP application step.
  if((payload.method==='tools/list'||payload.method==='tools/call')&&!roleVerified){
    try{await authorizeMcpBearer(bearer,identity.subject,env);}
    catch(error){return mcpRoleFailure(payload.id,error,config);}
  }
  switch(payload.method){
    case 'initialize':{
      const proposed=payload.params?.protocolVersion;
      return result(payload.id,{protocolVersion:SUPPORTED_PROTOCOLS.has(proposed)?proposed:DEFAULT_PROTOCOL,
        capabilities:{tools:{listChanged:false}},serverInfo:{name:'loc-mcp',version:'0.2.0',
           ...(proposed==='2025-11-25'?{icons:[{src:'https://loc.lo3rwang.cc/assets/site/icons/loc-favicon.png',mimeType:'image/png'}]}:{})},
        instructions:'Public Galaxy reads use the scoped ZenStack Galaxy ZModel with Kysely visibility filters. Private Galaxy reads use that scoped model after permission checks, while writes retain Kysely after Better Auth identity validation and independent api.manage permissions. loc_connection_status reports configuration only, not successful database read/write. galaxy_link.search is permitted only by explicit human user request and user_requested=true. 請至github頁面找尋PR相關資料！不開放搜尋PR!'});
    }
    case 'ping':return result(payload.id,{});
    case 'tools/list':return result(payload.id,{tools:TOOLS});
    case 'tools/call':{
      const name=payload.params?.name;
      if(!TOOLS.some(tool=>tool.name===name))return rpcError(payload.id,-32602,'Unknown tool');
      const args=parseMcpToolArgs(name,payload.params?.arguments??{});
      if(args===null)return rpcError(payload.id,-32602,'Invalid MCP tool arguments');
      if(name==='galaxy_link'&&args.action==='search'&&
        /(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(String(args.query||''))){
        return result(payload.id,{isError:true,content:[{type:'text',
          text:PR_SEARCH_WARNING}]});
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
        const value=name==='article_distribution'?
          await articleDistribution(args,env):
          name==='provider_list'?
          await providerStatuses(env,identity.subject):
          name==='provider_tools'?
          {provider:args.provider,tools:await listUpstreamTools(env,identity.subject,args.provider)}:
          name==='provider_call'?
          await requestTool(env,identity.subject,args.provider,args.tool,args.args||{}):
          name==='provider_receipt'?
          await approvalReceipt(env,identity.subject,args.approval_id):
          name==='read_memory'?
          await readMemory(args,env):
          directPrivate?await privateGalaxyLink(args,bearer,identity.subject,env):
          await businessAction(name,args,bearer,env);
        return toolResponse(payload.id,value);
      }catch(error){
        const validation=error?.code==='INVALID_ARGUMENT';
        return result(payload.id,{isError:true,content:[{type:'text',
          text:name?.startsWith('provider_')?
            String(error?.message||'Provider request unavailable').slice(0,180):
            validation?error.message:
            error?.httpStatus&&error.httpStatus<500?error.message:
            'LOC data service unavailable; please retry later.'}]});
      }
    }
    default:return rpcError(payload.id,-32601,'Method not found');
  }
}
