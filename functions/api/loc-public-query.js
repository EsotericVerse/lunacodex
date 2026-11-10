import {handleNativePublicQuery} from '../../app/loc/server/native-public-query.mjs';

// The same existing LOC Pages runtime handles public reads through Kysely.
// No browser Data API credentials or selectable SQL endpoints are accepted.
export function onRequest(context){
  return handleNativePublicQuery(context.request,context.env);
}
