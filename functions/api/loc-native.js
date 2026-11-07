import {handleNativeLocOperation} from '../../app/loc/mcp/native-operations.mjs';

// Existing LOC Pages application runtime; direct Kysely inside this process.
// Only the signed, fixed Galaxy/short-import operations can reach a driver.
export function onRequest(context){
  return handleNativeLocOperation(context.request,context.env);
}
