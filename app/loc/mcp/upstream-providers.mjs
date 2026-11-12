// LOC MCP upstream provider catalog and policy contract.
import {z} from 'zod';
// Identity is issued by LOC Auth; upstream providers issue their own tokens.
export const UPSTREAM_PROVIDERS=Object.freeze({
  clerk:Object.freeze({label:'Clerk',url:'https://mcp.clerk.com/mcp',hosts:['clerk.com']}),
  github:Object.freeze({label:'GitHub',url:'https://api.githubcopilot.com/mcp/',hosts:['github.com','githubcopilot.com']}),
  neon:Object.freeze({label:'Neon',url:'https://mcp.neon.tech/mcp',hosts:['neon.tech','neon.com']}),
  supabase:Object.freeze({label:'Supabase',url:'https://mcp.supabase.com/mcp',hosts:['supabase.com','supabase.co']})
});
export const LOC_MCP_CALLBACK='https://loc.lo3rwang.cc/api/mcp-provider-callback';
export const LOC_MCP_CLIENT_DOCUMENT='https://loc.lo3rwang.cc/.well-known/loc-mcp-client';
export const FUNCTION_MODES=Object.freeze(['auto','ask','deny']);
export const ProviderIdSchema=z.enum(Object.keys(UPSTREAM_PROVIDERS));
export const ProviderToolSchema=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/);
export const FunctionPolicySchema=z.enum(FUNCTION_MODES);
export const ProviderArgumentsSchema=z.looseObject({}).refine(
  value=>JSON.stringify(value).length<=12000,
  {error:'MCP tool arguments exceed 12 KB'}
);
const ApprovalIdSchema=z.string().regex(/^[A-Za-z0-9_-]{25,64}$/);
export const ProviderControlSchema=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('connect'),provider:ProviderIdSchema}),
  z.strictObject({action:z.literal('disconnect'),provider:ProviderIdSchema}),
  z.strictObject({action:z.literal('call'),provider:ProviderIdSchema,
    tool:ProviderToolSchema,args:ProviderArgumentsSchema.optional()}),
  z.strictObject({action:z.literal('policy'),provider:ProviderIdSchema,
    tool:ProviderToolSchema,mode:FunctionPolicySchema}),
  z.strictObject({action:z.literal('approve'),id:ApprovalIdSchema}),
  z.strictObject({action:z.literal('reject'),id:ApprovalIdSchema})
]);
export function upstreamProvider(id){
  const parsed=ProviderIdSchema.safeParse(id);
  if(!parsed.success)throw new Error('Unsupported MCP provider');
  return UPSTREAM_PROVIDERS[parsed.data];
}
export function trustedProviderUrl(provider,value){
  const config=upstreamProvider(provider);
  let url;
  try{url=new URL(value)}catch{throw new Error('Invalid provider endpoint')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
     url.port&&url.port!=='443'||!config.hosts.some(host=>
       url.hostname===host||url.hostname.endsWith('.'+host)))
    throw new Error('Untrusted provider OAuth endpoint');
  return url.href;
}
export function providerToolName(tool){
  const parsed=ProviderToolSchema.safeParse(tool);
  if(!parsed.success)throw new Error('Invalid MCP tool name');
  return parsed.data;
}
export function policyMode(mode){
  const parsed=FunctionPolicySchema.safeParse(mode);
  if(!parsed.success)throw new Error('Invalid function policy');
  return parsed.data;
}
export function providerArguments(value){
  const parsed=ProviderArgumentsSchema.safeParse(value);
  if(!parsed.success)throw new Error('Invalid MCP tool arguments or size');
  return parsed.data;
}
export function publicProviderStatus(id,linked,policies={}){
  const p=upstreamProvider(id);
  return {id,label:p.label,connected:Boolean(linked),mcp_url:p.url,policies};
}
