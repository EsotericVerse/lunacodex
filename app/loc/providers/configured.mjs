// One provider-neutral browser composition point. LOC Authority owns SQL grants;
// the identity adapter is replaceable without changing any SQL caller.
// Signed identity is provided by LOC Auth; SQL providers remain interchangeable.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
// Temporary existing SQL HTTP transport. These are PUBLIC endpoint identifiers,
// not a database password or an Auth SDK dependency. Remove both only after
// the independently hosted LOC SQL Gateway is verified in production.
const COMPAT_SQL_ORIGIN='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const COMPAT_SQL_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  // The former SQL transport is retained only while the independent Gateway
  // lacks a live HTTPS URL. Vendor Auth SDKs are never used by either path.
  url=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_URL||COMPAT_SQL_ORIGIN,
  publishableKey=gatewayUrl?'':process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||COMPAT_SQL_PUBLIC_KEY,
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
