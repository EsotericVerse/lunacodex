import {handleMcp} from '../app/loc/mcp/router.mjs';

// The MCP custom domain serves the protocol at its root.
// All other hostnames retain the existing LOC homepage.
export function onRequest(context){
  if(new URL(context.request.url).hostname==='mcp.lo3rwang.cc')
    return handleMcp(context.request,context.env);
  return context.next();
}
