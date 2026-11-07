// LOC Auth is independent of database transport. In the static Pages build,
// public reads use the database owner's existing HTTPS Data API directly.
// This is not an SQL Gateway or an independently hosted LOC SQL service.
import {createLocAccountAdapter} from '../auth/loc-browser.mjs';
import {createLocGatewayAdapter} from './loc-gateway.mjs';
import {createDirectDataApiClient} from './direct-data-api.mjs';

const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const DEFAULT_PUBLIC_DATABASE='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const apiUrl=()=>process.env.NEXT_PUBLIC_LOC_DATA_API_URL||
  (process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_PUBLIC_DATABASE).replace(/\/+$/,'')+'/rest/v1';
const apiKey=()=>process.env.NEXT_PUBLIC_LOC_DATA_API_PUBLIC_KEY||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||DEFAULT_PUBLIC_KEY;

export function createConfiguredAdapter({
  accountAdapter,
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||DEFAULT_AUTHORITY,
  gatewayUrl=process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'',
  url=apiUrl(),publishableKey=apiKey(),
  fetchImpl=globalThis.fetch
}={}){
  const identity=accountAdapter||createLocAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  // Once the independent LOC SQL host is configured, all public and signed
  // reads/writes use the same native Kysely + LOC OAuth delegation transport.
  // No provider-specific Data API or SQL credentials are passed to the browser.
  if(String(gatewayUrl||'').trim()){
    return createLocGatewayAdapter({
      accountAdapter:identity,authorityUrl,gatewayUrl,fetchImpl
    });
  }
  // Transitional public-read compatibility for the currently deployed static
  // site. Remove only after the independent SQL Gateway is actually online.
  const publicClient=createDirectDataApiClient({url,apiKey:publishableKey,role:'anon',fetch:fetchImpl});
  // LOC OAuth JWTs are NOT database credentials. Authenticated SQL writes
  // require the database owner's server-side connection, never a public API key.
  const authClient=createDirectDataApiClient({url,apiKey:publishableKey,
    role:'authenticated',fetch:fetchImpl});
  return {publicClient,authClient,auth:identity.auth,
    configuredPublicClient:publicClient,backupPublicClient:null,
    realtimeClient:null,primarySourceLabel:'主要資料庫連線',backupSourceLabel:''};
}
