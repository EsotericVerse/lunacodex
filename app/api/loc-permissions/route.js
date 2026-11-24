import {handleLocSelfPermissions} from '../../loc/permissions/loc-permissions-server.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function GET(request){
  return handleLocSelfPermissions(request);
}

export function POST(request){
  return handleLocSelfPermissions(request);
}
