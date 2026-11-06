// Legacy website identity and Realtime bridge. LOC SQL/Auth core has no
// vendor-specific imports; this optional wrapper is removable after login
// and realtime cutover have passed their production acceptance checks.
import {createClerkAccountAdapter} from '../auth/clerk-browser.mjs';
import {createClient} from '@supabase/supabase-js';
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
  accountAdapter=null,realtimeClientFactory=createClient,
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
  const realtimeClient=realtimeClientFactory?realtimeClientFactory(url,publishableKey,{
    db:{schema:'silver'},global:{fetch:fetchImpl},
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,
      storageKey:'loc-legacy-realtime'}
  }):null;
  return createLocGatewayAdapter({
    authorityUrl,accountAdapter:identity,
    url,publishableKey,
    gatewayUrl:privateEndpoint,publicGatewayUrl:publicEndpoint,
    realtimeClient,fetchImpl
  });
}
