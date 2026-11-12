// LOC MCP upstream provider catalog and policy contract.
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
const TOOL_NAME=/^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/;
export function upstreamProvider(id){
  if(!Object.hasOwn(UPSTREAM_PROVIDERS,id))throw new Error('Unsupported MCP provider');
  return UPSTREAM_PROVIDERS[id];
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
  if(typeof tool!=='string'||!TOOL_NAME.test(tool))throw new Error('Invalid MCP tool name');
  return tool;
}
export function policyMode(mode){
  if(!FUNCTION_MODES.includes(mode))throw new Error('Invalid function policy');
  return mode;
}
export function providerArguments(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('MCP arguments must be an object');
  const serialized=JSON.stringify(value);
  if(!serialized||serialized.length>12000)throw new Error('MCP tool arguments exceed 12 KB');
  return JSON.parse(serialized);
}
export function publicProviderStatus(id,linked,policies={}){
  const p=upstreamProvider(id);
  return {id,label:p.label,connected:Boolean(linked),mcp_url:p.url,policies};
}
