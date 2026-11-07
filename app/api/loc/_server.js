import {createDirectDataApiClient} from '../../loc/providers/direct-data-api.mjs';

const DEFAULT_PUBLIC_DATABASE='https://qlouywsdiiyiyzpoxyqy.supabase.co';
const DEFAULT_PUBLIC_KEY='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}
// Server-rendered public summaries read from the database owner's Data API.
// There is no additional LOC SQL network hop.
export function publicNumericSources({fetchImpl=globalThis.fetch,
  url=process.env.LOC_DATA_API_URL||process.env.NEXT_PUBLIC_LOC_DATA_API_URL||
    (process.env.NEXT_PUBLIC_SUPABASE_URL||DEFAULT_PUBLIC_DATABASE).replace(/\/+$/,'')+'/rest/v1',
  apiKey=process.env.LOC_DATA_API_PUBLIC_KEY||process.env.NEXT_PUBLIC_LOC_DATA_API_PUBLIC_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||DEFAULT_PUBLIC_KEY
}={}){
  const primary=createDirectDataApiClient({url,apiKey,role:'anon',fetch:fetchImpl});
  return [{id:'primary',schema:()=>primary.schema('silver')}];
}
