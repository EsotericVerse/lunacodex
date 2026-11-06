// Public Culture/Statistics only use an explicitly published source snapshot.
// The source Anchor records themselves remain inaccessible to anonymous reads.
import {publishedSourceTaxonomy} from '../modular/published-source-taxonomy.js';
export async function readPublicSourceTaxonomy(scopeId){
  const published=publishedSourceTaxonomy(scopeId);
  if(!published)throw new Error('來源分類尚未發布');
  return published;
}
