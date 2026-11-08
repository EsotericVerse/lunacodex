import {handleNativePublicContent} from '../../app/loc/server/native-public-content.mjs';

// Existing LOC Pages application; no separately deployed SQL service.
export function onRequestGet(context){
  return handleNativePublicContent(context.request,context.env);
}
