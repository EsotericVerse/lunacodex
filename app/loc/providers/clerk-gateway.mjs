// Clerk is the sole interactive LOC identity. Existing
// Supabase SQL remains the primary data source until Neon schema is ready.
// All private writes go through Kysely with verified Clerk JWT and DB RLS.
import {createClerkAccountAdapter} from '../auth/clerk-browser.mjs';
import {createKyselyEdgeClient} from './kysely-edge.mjs';
import {createClient} from '@supabase/supabase-js';

const FALLBACK_AUTHORITY='https://loc-authority-control.sopa2306.workers.dev';
const DEFAULT_SUPABASE_URL='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLISHABLE_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

export function createClerkGatewayAdapter({
  authorityUrl=process.env.NEXT_PUBLIC_LOC_CONTROL_URL||FALLBACK_AUTHORITY,
  url=process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_SUPABASE_URL,
  publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_PUBLISHABLE_KEY,
  fetchImpl=globalThis.fetch
}={}){
  const {auth,getAccessToken}=createClerkAccountAdapter({
    authorityOrigin:authorityUrl,fetchImpl
  });
  // Public-only Supabase SDK: never persists a Supabase Auth session and
  // never processes an OAuth callback. Clerk owns all interactive login.
  const publicSdk=createClient(url,publishableKey,{
    db:{schema:'silver'},
    global:{fetch:fetchImpl},
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,
      storageKey:'loc-clerk-public'}
  });
  const publicSql=createKyselyEdgeClient({
    url,publishableKey,role:'anon',target:'configured',fetch:fetchImpl
  });
  const edge=createKyselyEdgeClient({
    url,publishableKey,role:'authenticated',target:'configured',
    gatewayUrl:String(url).replace(/\/+$/,'')+'/functions/v1/loc-kysely-clerk',
    getAccessToken,fetch:fetchImpl
  });
  return {
    // All LOC public data follows the selected Kysely target; Supabase SDK stays for Realtime only.
    publicClient:publicSql,
    authClient:edge,auth,
    configuredPublicClient:publicSql,
    backupPublicClient:null,
    realtimeClient:publicSdk,
    primarySourceLabel:'Supabase SQL · Clerk 身分',
    backupSourceLabel:''
  };
}
