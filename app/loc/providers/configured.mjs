// LOC Auth handles identity; the independent LOC SQL Gateway handles queries.
// Database placement and dialect are selected inside the Gateway, not the browser.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  fetchImpl=globalThis.fetch
}={}){
  const endpoint=String(gatewayUrl||'').trim();
  if(!endpoint)throw new Error('LOC SQL Gateway is not configured');
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  return createLocGatewayAdapter({
    authorityUrl,accountAdapter:identity,gatewayUrl:endpoint,
    publicGatewayUrl:endpoint,realtimeClient:null,fetchImpl
  });
}
