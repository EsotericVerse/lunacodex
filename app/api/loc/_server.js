import {createDirectDataApiClient} from '../../loc/providers/direct-data-api.mjs';
import {createKyselyEdgeClient} from '../../loc/providers/kysely-edge.mjs';

const DEFAULT_PUBLIC_DATABASE='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}
// Server-rendered public summaries read from the database owner's Data API.
// There is no additional LOC SQL network hop.
export function publicNumericSources({fetchImpl=globalThis.fetch,
  primaryGatewayUrl=process.env.LOC_SQL_GATEWAY_URL||
    process.env.NEXT_PUBLIC_LOC_SQL_GATEWAY_URL||'',
  backupGatewayUrl=process.env.LOC_BACKUP_SQL_GATEWAY_URL||'',
  url=process.env.LOC_DATA_API_URL||process.env.NEXT_PUBLIC_LOC_DATA_API_URL||
    (process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_PUBLIC_DATABASE).replace(/\/+$/,'')+'/rest/v1',
  apiKey=process.env.LOC_DATA_API_PUBLIC_KEY||process.env.NEXT_PUBLIC_LOC_DATA_API_PUBLIC_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_PUBLIC_KEY
}={}){
  // One SQL transport on every engine. A backup must be an independent
  // owner-controlled SQL Gateway, not a vendor's Auth or Data API fallback.
  // No anonymous SQL credential or OAuth token is placed in the response.
  const primary=String(primaryGatewayUrl||'').trim()
    ?createKyselyEdgeClient({gatewayUrl:primaryGatewayUrl,role:'anon',fetch:fetchImpl})
    :createDirectDataApiClient({url,apiKey,role:'anon',fetch:fetchImpl});
  const sources=[{id:'primary',schema:()=>primary.schema('silver')}];
  if(String(backupGatewayUrl||'').trim()){
    if(!String(primaryGatewayUrl||'').trim())
      throw new Error('LOC SQL backup requires an independent primary SQL Gateway');
    const backup=createKyselyEdgeClient({
      gatewayUrl:backupGatewayUrl,role:'anon',fetch:fetchImpl
    });
    sources.push({id:'backup',schema:()=>backup.schema('silver')});
  }
  return sources;
}
