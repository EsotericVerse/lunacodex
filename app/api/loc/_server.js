import {createClient} from '@supabase/supabase-js';
import {createBackupPublicAdapter} from '../../loc/providers/neon-public.mjs';
import {createKyselyEdgeClient} from '../../loc/providers/kysely-edge.mjs';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||'https://qlouywsdiiyiyzpoxyqy.supabase.co';
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

// Only anonymous/public SQL-backed numeric summaries use this server client.
// Public Blocks, registry/config and site metadata are build-produced assets.
export function createPublicSupabaseClient(){
  return createClient(SUPABASE_URL,SUPABASE_KEY,{
    db:{schema:'silver'},
    auth:{persistSession:false,autoRefreshToken:false}
  });
}

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}

// Only the optional ISR service uses this public, non-privileged failover.
// A configured Neon replica is reached directly, never via Supabase Functions.
export function publicNumericSources({fetchImpl=globalThis.fetch}={}){
  const timedFetch=(input,init={})=>{
    const timeout=AbortSignal.timeout(6500);
    const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
    return fetchImpl(input,{...init,signal});
  };
  const primary=createClient(SUPABASE_URL,SUPABASE_KEY,{
    db:{schema:'silver'},
    global:{fetch:timedFetch},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const gateway=createKyselyEdgeClient({url:SUPABASE_URL,publishableKey:SUPABASE_KEY,
    target:'configured',role:'anon',fetch:timedFetch});
  const candidates=[{id:'supabase',schema:()=>({
    from:table=>primary.schema('silver').from(table),
    analytics:args=>gateway.schema('silver').analytics(args),
    publicAction:(name,args)=>gateway.schema('silver').publicAction(name,args)
  })}];
  if(process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL&&process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL){
    let neon=null;
    candidates.push({id:'neon',schema:()=>{
      neon??=createBackupPublicAdapter({fetchImpl:timedFetch}).publicClient;
      return neon.schema('silver');
    }});
  }
  return candidates;
}
