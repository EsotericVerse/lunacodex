import {createKyselyEdgeClient} from '../../loc/providers/kysely-edge.mjs';

const SQL_PROVIDER_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||
  'https://qlouywsdiiyiyzpoxyqy.supabase.co';
const PUBLIC_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
  'sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

// This is a transport URL, not a database provider or an Auth issuer.
// Without an independent gateway, preserve the existing production Edge target.
const SQL_GATEWAY_URL=process.env.LOC_SQL_GATEWAY_URL||
  process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'';
const BACKUP_SQL_GATEWAY_URL=process.env.LOC_BACKUP_SQL_GATEWAY_URL||'';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}

// Optional ISR does not instantiate a Supabase Auth or Data API SDK.
// Both public numeric reads and analytics use the same bounded Kysely transport.
// Optional backup uses a second independently hosted Kysely SQL Gateway.
// No database vendor Auth or PostgREST token service participates.
export function publicNumericSources({fetchImpl=globalThis.fetch,
  backupGatewayUrl=BACKUP_SQL_GATEWAY_URL}={}){
  const timedFetch=(input,init={})=>{
    const timeout=AbortSignal.timeout(6500);
    const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
    return fetchImpl(input,{...init,signal});
  };
  const primary=createKyselyEdgeClient({
    url:SQL_PROVIDER_URL,publishableKey:PUBLIC_KEY,
    gatewayUrl:SQL_GATEWAY_URL,target:'configured',role:'anon',fetch:timedFetch
  });
  const candidates=[{id:'primary',schema:()=>primary.schema('silver')}];
  if(backupGatewayUrl){
    // Independent backup must not share the primary Gateway origin.
    const primaryOrigin=new URL(SQL_GATEWAY_URL||SQL_PROVIDER_URL).origin;
    const backupOrigin=new URL(backupGatewayUrl).origin;
    if(primaryOrigin===backupOrigin)
      throw new Error('Backup SQL Gateway must use an independent origin');
    const backup=createKyselyEdgeClient({
      gatewayUrl:backupGatewayUrl,target:'configured',role:'anon',fetch:timedFetch
    });
    candidates.push({id:'backup',schema:()=>backup.schema('silver')});
  }
  return candidates;
}
