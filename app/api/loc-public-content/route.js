import {handleNativePublicContent} from '../../loc/server/native-public-content.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function GET(request){
  return handleNativePublicContent(request,process.env);
}
