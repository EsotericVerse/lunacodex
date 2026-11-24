import {handleNativePublicClasses} from '../../loc/mcp/public-classes.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function GET(request){
  return handleNativePublicClasses(request,process.env);
}
