import {handleNativePublicContent} from '../../app/loc/server/native-public-content.mjs';
import {withOptionalNumericEdgeCache} from '../../app/loc/server/optional-numeric-edge-cache.mjs';

// Existing LOC Pages application. When opt-in is OFF, there is no cache IO;
// when ON, a miss/error always falls through to the same native SQL reader.
export function onRequestGet(context){
  return withOptionalNumericEdgeCache(context,
    ()=>handleNativePublicContent(context.request,context.env));
}
