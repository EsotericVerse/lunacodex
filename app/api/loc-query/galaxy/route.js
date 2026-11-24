import {handleManagedQueryRoute} from '../../../loc/actions/managed-query-route.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export function POST(request){
  return handleManagedQueryRoute(request,'galaxy');
}
