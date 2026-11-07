import {handleMcp} from '../app/loc/mcp/router.mjs';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';

// /mcp is a second route of the same LOC MCP application. Keep identical
// in-process database binding with the root custom-domain route.
export function onRequest(context){
  const bindings=context.env;
  return handleMcp(context.request,{
    ...bindings,locDirectDatabase:(verifiedAlias='')=>directMcpKysely(bindings,verifiedAlias)
  });
}
