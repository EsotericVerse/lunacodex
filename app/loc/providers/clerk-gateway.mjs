// Legacy Clerk identity adapter for LOC's provider-neutral SQL Gateway.
// Realtime is handled independently by the LOC tabletop Worker.
import {createClerkAccountAdapter} from '../auth/clerk-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';

const DEFAULT_SUPABASE_URL='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLISHABLE_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';

export function createClerkGatewayAdapter({
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  url=process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_SUPABASE_URL,
  publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_PUBLISHABLE_KEY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  accountAdapter=null,
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createClerkAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const sqlBase=String(url).replace(/\/+$/,'');
  // The old site uses separate public/private Edge slugs. A standalone LOC
  // Gateway intentionally uses one provider-neutral endpoint for both.
  const privateEndpoint=gatewayUrl||sqlBase+'/functions/v1/loc-kysely-clerk';
  const publicEndpoint=gatewayUrl||'';
  return createLocGatewayAdapter({
    authorityUrl,accountAdapter:identity,
    url,publishableKey,
    gatewayUrl:privateEndpoint,publicGatewayUrl:publicEndpoint,
    realtimeClient:null,fetchImpl
  });
}
