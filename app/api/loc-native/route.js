import {handleNativeLocOperation} from '../../loc/bridge/native-operations.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request){
  return handleNativeLocOperation(request,process.env,{entrypoint:'loc-native'});
}
