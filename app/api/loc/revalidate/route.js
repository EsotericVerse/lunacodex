import {withLocCors,locCorsPreflight} from '../_cors';

// Authorized editors refresh shared client-query keys, not a remote cache.
export async function POST(request){
  return withLocCors(Response.json({error:'ISR suspended'},{
    status:410,headers:{'Cache-Control':'no-store'}
  }),request,{methods:'POST, OPTIONS'});
}
export function OPTIONS(request){return locCorsPreflight(request,{methods:'POST, OPTIONS'});}
