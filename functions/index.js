import {handleMcp} from '../app/loc/mcp/router.mjs';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

// Existing Pages MCP application executes bounded operations with its own
// Kysely connection. No SQL Gateway/Edge HTTP service is involved.
// The database profile and credential exist only in server-side bindings.
export function onRequest(context){
  if(new URL(context.request.url).hostname==='mcp.lo3rwang.cc'){
    const bindings=context.env;
    return handleMcp(context.request,{
      ...bindings,locDirectDatabase:()=>directMcpKysely(bindings)
    });
  }
  return context.next();
}
