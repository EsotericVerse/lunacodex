// Shared public source catalogue. The Pages native SQL endpoint resolves
// silver.loc_anchor through the fixed ZenStack LocAnchor ZModel; only the
// four source types and their UID links are projected to the browser.
import {createKyselyPublicClient} from './providers/kysely-browser.mjs';
import {sourceTaxonomyFromAnchors} from './source-classification.mjs';

const publicClient=createKyselyPublicClient();

export async function readPublicSourceTaxonomy(){
  const {data,error}=await publicClient.schema('silver').from('loc_anchor')
    .select('uid,type,title,invisible,attr').limit(200);
  if(error)throw error;
  return sourceTaxonomyFromAnchors(data);
}
