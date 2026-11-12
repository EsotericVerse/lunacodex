// Streamable HTTP MCP client. Never forwards LOC identity tokens upstream.
import {upstreamProvider,trustedProviderUrl,providerToolName,providerArguments}
  from './upstream-providers.mjs';
import {upstreamConnection} from './upstream-oauth.mjs';
import {readBoundedJson,readBoundedText} from './stream-json.mjs';
import {z} from 'zod';
const VERSION='2025-11-25';
const UpstreamReplySchema=z.looseObject({
  jsonrpc:z.literal('2.0'),
  id:z.union([z.string(),z.number()]),
  result:z.unknown().optional(),
  error:z.looseObject({code:z.number(),message:z.string()}).optional()
}).refine(value=>value.result!==undefined||value.error!==undefined);
function matchedReply(value,id){
  const parsed=UpstreamReplySchema.safeParse(value);
  return parsed.success&&parsed.data.id===id?parsed.data:null;
}
// Streaming JSON for regular MCP replies; bounded SSE event bodies for progress.
export async function parseUpstreamReply(response,id){
  const type=response.headers.get('content-type')||'application/json';
  if(type.includes('text/event-stream')){
    const content=await readBoundedText(response.body,300000);
    for(const event of content.split(/\r?\n\r?\n/)){
      const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:'))
        .map(line=>line.slice(5).trim()).join('\n');
      if(!data)continue;
      let value;
      try{value=JSON.parse(data)}catch{continue}
      if(value?.jsonrpc==='2.0'&&value.id===id){
        const checked=matchedReply(value,id);
        if(!checked)throw new Error('Invalid upstream MCP response');
        return checked;
      }
    }
    throw new Error('Upstream MCP response is missing its request ID');
  }
  const value=await readBoundedJson(response.body,300000);
  const checked=matchedReply(value,id);
  if(!checked)throw new Error('Invalid upstream MCP response ID');
  return checked;
}
function protocolError(value){
  if(value?.error)throw new Error('Upstream MCP refused the tool ('+
    String(value.error.code||'error')+')');
  if(!value||value.jsonrpc!=='2.0')throw new Error('Invalid upstream MCP response');
  return value.result||{};
}
async function postMcp(provider,access,session,method,params,id){
  const address=upstreamProvider(provider).url;
  trustedProviderUrl(provider,address);
  const body=JSON.stringify({jsonrpc:'2.0',...(id!=null?{id}:{}),
    method,...(params?{params}:{})});
  const headers={'authorization':'Bearer '+access,
    'content-type':'application/json','accept':'application/json, text/event-stream',
    'mcp-protocol-version':session.version||VERSION,
    ...(session.id?{'mcp-session-id':session.id}:{})};
  const response=await fetch(address,{method:'POST',headers,body,redirect:'error',
    signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Upstream MCP unavailable ('+response.status+')');
  if(response.headers.get('mcp-session-id'))session.id=response.headers.get('mcp-session-id');
  if(response.status===202||id==null)return {};
  return protocolError(await parseUpstreamReply(response,id));
}
async function sessionFor(env,subject,provider){
  const entry=await upstreamConnection(env,subject,provider);
  if(!entry)throw new Error('Provider is not connected; authorize it first');
  const session={version:VERSION,id:''};
  const init=await postMcp(provider,entry.access_token,session,'initialize',{
    protocolVersion:VERSION,capabilities:{},clientInfo:{name:'loc-mcp-gateway',version:'1.0.0'}
  },1);
  if(init.protocolVersion)session.version=String(init.protocolVersion);
  await postMcp(provider,entry.access_token,session,'notifications/initialized',null,null);
  return {access:entry.access_token,session};
}
export async function listUpstreamTools(env,subject,provider){
  const {access,session}=await sessionFor(env,subject,provider);
  const tools=[];let cursor='';
  for(let page=0;page<5;page++){
    const value=await postMcp(provider,access,session,'tools/list',
      cursor?{cursor}: {},page+2);
    if(!Array.isArray(value.tools))throw new Error('Provider returned invalid tool list');
    for(const tool of value.tools){
      if(!tool||typeof tool.name!=='string')continue;
      try{providerToolName(tool.name)}catch{continue}
      tools.push({name:tool.name,description:String(tool.description||'').slice(0,240),
        readOnlyHint:tool.annotations?.readOnlyHint===true});
      if(tools.length>=300)return tools;
    }
    if(!value.nextCursor)break;
    if(value.nextCursor===cursor)throw new Error('Repeated MCP tool cursor');
    cursor=String(value.nextCursor);
  }
  return tools;
}
export async function invokeUpstreamTool(env,subject,provider,tool,args){
  providerToolName(tool);providerArguments(args);
  const {access,session}=await sessionFor(env,subject,provider);
  const response=await postMcp(provider,access,session,'tools/call',
    {name:tool,arguments:args},2);
  const serialized=JSON.stringify(response);
  if(serialized.length>150000)throw new Error('MCP tool result exceeds LOC response limit');
  return response;
}
