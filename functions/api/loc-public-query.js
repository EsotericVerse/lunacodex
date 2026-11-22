import {handleNamedPublicTransaction} from '../../app/loc/server/public-named-transactions.mjs';

// No generic SQL/query executor is exposed by this route.
export async function onRequest(context){
  return handleNamedPublicTransaction(context.request,context.env,
    {waitUntil:context.waitUntil});
}
