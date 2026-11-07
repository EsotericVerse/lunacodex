import {handleNativePublicClasses} from '../../app/loc/mcp/public-classes.mjs';

// Fixed public projection of explicitly published Class labels; never SQL input.
export function onRequest(context){
  return handleNativePublicClasses(context.request,context.env);
}
