// Flat public source classification, published with Scope Config.
import {sourceTaxonomyFromArrays,sourceTreeFromArrays,sourceSiteKeyForLabel} from '../loc/source-classification.mjs';
export const PUBLISHED_SOURCE_LISTS=Object.freeze({
  loc:{system:['Facebook','Threads','Instagram'],personal:[]},
  lo3rwang:{system:['Facebook','Threads','Instagram'],personal:['suno','kkcity','其他','方格子vocus','ptt','無名wretch','pixnet']},
  lrunes:{system:['Facebook','Threads','Instagram'],personal:['vocus','others','suno']}
});
// Galaxy.site stays literal. Canonical short keys are inferred from existing
// From labels (e.g. 方格子vocus -> vocus), not maintained in another alias map.
export const PUBLISHED_SOURCE_TAXONOMY=Object.freeze(Object.fromEntries(
  Object.entries(PUBLISHED_SOURCE_LISTS).map(([id,lists])=>{
    const taxonomy=sourceTaxonomyFromArrays(lists.system,lists.personal);
    const tree=sourceTreeFromArrays(lists.system,lists.personal,{universe:'loc',galaxy:id});
    const aliases=tree.filter(node=>node.type==='from'&&node.parent.endsWith(':personal'))
      .map(node=>({source_key:sourceSiteKeyForLabel(node.name),
        group_code:node.name.normalize('NFKC').toLocaleLowerCase()}))
      .filter(item=>!taxonomy.groupAliases.some(existing=>
        existing.source_key===item.source_key&&existing.group_code===item.group_code));
    return [id,{...taxonomy,tree,groupAliases:[...taxonomy.groupAliases,...aliases]}];
  })
));
export function publishedSourceTaxonomy(scopeId){
  return Object.prototype.hasOwnProperty.call(PUBLISHED_SOURCE_TAXONOMY,scopeId)?PUBLISHED_SOURCE_TAXONOMY[scopeId]:null;
}

// The same published, flat source catalogue powers both Culture and Statistics.
// Present a display-level grouping only; neither table nor stored IDs exist.
export function publishedSourceCategoryCatalog(scopeId){
  const taxonomy=publishedSourceTaxonomy(scopeId);
  if(!taxonomy)return null;
  return {
    categories:[...taxonomy.categories,...taxonomy.groups.map(row=>({
      category_code:row.group_code,display_name:row.display_name,enabled:row.enabled
    }))],
    aliases:[...taxonomy.aliases,...taxonomy.groupAliases.map(row=>({
      source_key:row.source_key,category_code:row.group_code
    }))]
  };
}
