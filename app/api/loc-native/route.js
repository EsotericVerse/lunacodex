import {handleNativeLocOperation} from '../../loc/mcp/native-operations.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request){
  return handleNativeLocOperation(request,process.env,{entrypoint:'loc-native'});
}
