import {handleNativePublicContent} from '../../app/loc/server/native-public-content.mjs';

// Public content has one direct business reader. No inactive ISR or optional
// Cloudflare Cache API wrapper, TTL, alternate route or cache environment flag.
export function onRequestGet(context){
  return handleNativePublicContent(context.request,context.env,
    {waitUntil:context.waitUntil});
}
