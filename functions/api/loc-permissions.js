import {handleLocSelfPermissions} from '../../app/loc/permissions/loc-permissions-server.mjs';

// Session self-only; does not query api.manage or expose other users.
export async function onRequest(context){
  return handleLocSelfPermissions(context.request);
}
