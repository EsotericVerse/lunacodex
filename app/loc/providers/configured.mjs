// One provider-neutral browser composition point. LOC Authority owns SQL grants;
// the identity adapter is replaceable without changing any SQL caller.
// Signed identity is provided by LOC Auth; SQL providers remain interchangeable.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  // The former SQL transport is retained only while the independent Gateway
  // lacks a live HTTPS URL. Vendor Auth SDKs are never used by either path.
  url=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_URL||'',
  publishableKey=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'',
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  const endpoint=gatewayUrl||(url&&publishableKey?
    url.replace(/\/+$/,'')+'/functions/v1/loc-kysely':'');
  return createLocGatewayAdapter({
    authorityUrl,accountAdapter:identity,url,publishableKey,
    gatewayUrl:endpoint,publicGatewayUrl:endpoint,
    realtimeClient:null,fetchImpl
  });
}
