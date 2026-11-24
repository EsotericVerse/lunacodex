import {handleNativeLocOperation} from '../mcp/native-operations.mjs';
import {MANAGED_QUERY_ROUTE_ACTIONS} from './managed-query-routes.mjs';

export function handleManagedQueryRoute(request,feature){
  const allowedManagedActions=MANAGED_QUERY_ROUTE_ACTIONS[feature];
  if(!allowedManagedActions)throw Error('Unknown LOC query route');
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)
    return new Response(JSON.stringify({error:{message:'Cross-origin request denied'}}),{
      status:403,headers:{'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store','x-content-type-options':'nosniff'}
    });
  return handleNativeLocOperation(request,process.env,{allowedManagedActions});
}
