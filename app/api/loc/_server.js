import {createBackupPublicAdapter} from '../../loc/providers/neon-public.mjs';
import {createKyselyEdgeClient} from '../../loc/providers/kysely-edge.mjs';

const SQL_PROVIDER_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||
  'https://qlouywsdiiyiyzpoxyqy.supabase.co';
const PUBLIC_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
  'sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

// This is a transport URL, not a database provider or an Auth issuer.
// Without an independent gateway, preserve the existing production Edge target.
const SQL_GATEWAY_URL=process.env.LOC_SQL_GATEWAY_URL||
  process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}

// Optional ISR does not instantiate a Supabase Auth or Data API SDK.
// Both public numeric reads and analytics use the same bounded Kysely transport.
// Neon remains an independently hosted fallback until its direct Kysely target
// has been deployed and checked; never tunnel a backup through primary.
export function publicNumericSources({fetchImpl=globalThis.fetch}={}){
  const timedFetch=(input,init={})=>{
    const timeout=AbortSignal.timeout(6500);
    const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
    return fetchImpl(input,{...init,signal});
  };
  const primary=createKyselyEdgeClient({
    url:SQL_PROVIDER_URL,publishableKey:PUBLIC_KEY,
    gatewayUrl:SQL_GATEWAY_URL,target:'configured',role:'anon',fetch:timedFetch
  });
  const candidates=[{id:'supabase',schema:()=>primary.schema('silver')}];
  if(process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL&&process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL){
    let neon=null;
    candidates.push({id:'neon',schema:()=>{
      neon??=createBackupPublicAdapter({fetchImpl:timedFetch}).publicClient;
      return neon.schema('silver');
    }});
  }
  return candidates;
}
