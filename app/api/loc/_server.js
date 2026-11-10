import {createKyselyPublicClient} from '../../loc/providers/kysely-browser.mjs';

export function validScopeId(value){
  return /^[a-z][a-z0-9]{0,14}$/.test(String(value||''));
}
// Static-site server summaries use the existing Pages/Kysely public reader,
// never the database vendor's REST API.
export function publicNumericSources({fetchImpl=globalThis.fetch}={}){
  const primary=createKyselyPublicClient({role:'anon',
    fetch:(path,options)=>fetchImpl(new URL(path,'https://loc.lo3rwang.cc').href,options)});
  return [{id:'primary',schema:()=>primary.schema('silver')}];
}
