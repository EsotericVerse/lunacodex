// One provider-neutral browser composition point. LOC Authority owns SQL grants;
// the identity adapter is replaceable without changing any SQL caller.
// Until LOC OAuth is deployed, Clerk remains the optional active identity source.
import {createClerkAccountAdapter} from '../auth/clerk-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const LEGACY_SQL_ORIGIN='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const LEGACY_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  url=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_URL||LEGACY_SQL_ORIGIN,
  publishableKey=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||LEGACY_PUBLIC_KEY,
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createClerkAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  // Legacy hosted SQL transport is a compatibility fallback, not a required
  // identity or provider dependency for an independent LOC SQL Gateway.
  const endpoint=gatewayUrl||url.replace(/\/+$/,'')+'/functions/v1/loc-kysely';
  return createLocGatewayAdapter({
    authorityUrl,accountAdapter:identity,url,publishableKey,
    gatewayUrl:endpoint,publicGatewayUrl:endpoint,
    realtimeClient:null,fetchImpl
  });
}
