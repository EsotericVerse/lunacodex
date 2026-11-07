import {createKyselyEdgeClient} from '../../loc/providers/kysely-edge.mjs';

// The SQL Gateway is the only runtime database transport.
const SQL_GATEWAY_URL=process.env.LOC_SQL_GATEWAY_URL||
  process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||
  process.env.NEXT_PUBLIC_LOC_KYSELY_GATEWAY_URL||'';
const BACKUP_SQL_GATEWAY_URL=process.env.LOC_BACKUP_SQL_GATEWAY_URL||'';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}

// Optional ISR reads through independent LOC SQL, with no provider Auth SDK.
// Both public numeric reads and analytics use the same bounded Kysely transport.
// Optional backup uses a second independently hosted Kysely SQL Gateway.
// No database vendor Auth or PostgREST token service participates.
export function publicNumericSources({fetchImpl=globalThis.fetch,
  primaryGatewayUrl=SQL_GATEWAY_URL,
  backupGatewayUrl=BACKUP_SQL_GATEWAY_URL}={}){
  const timedFetch=(input,init={})=>{
    const timeout=AbortSignal.timeout(6500);
    const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
    return fetchImpl(input,{...init,signal});
  };
  const primary=createKyselyEdgeClient({
    gatewayUrl:primaryGatewayUrl,target:'configured',role:'anon',fetch:timedFetch
  });
  const candidates=[{id:'primary',schema:()=>primary.schema('silver')}];
  if(backupGatewayUrl){
    // Independent backup must not share the primary Gateway origin.
    const primaryOrigin=new URL(primaryGatewayUrl).origin;
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
