// Shared public source catalogue. The native public SQL endpoint resolves
// silver.loc_anchor through the existing ZenStack LocAnchor ZModel; only the
// four source types and their UID links are projected to the browser.
import {dbPublicClient} from './db-client.mjs';
import {sourceTaxonomyFromAnchors} from './source-classification.mjs';

export async function readPublicSourceTaxonomy(){
  const {data,error}=await dbPublicClient.schema('silver').from('loc_anchor')
    .select('uid,type,title,invisible,attr').limit(200);
  if(error)throw error;
  return sourceTaxonomyFromAnchors(data);
}
