// PUBLIC Source Anchor catalogue. Updated only by explicit sync:public.
// Scope From titles are Galaxy.site comparison keys; labels are presentation.
import {sourceTaxonomyFromCatalog} from '../loc/source-classification.mjs';
export const PUBLISHED_SOURCE_LISTS=Object.freeze({"loc":{"system":["Facebook","Threads","Instagram"],"personal":[]},"lo3rwang":{"system":["Facebook","Threads","Instagram"],"personal":["suno","kkcity","其他","方格子vocus","ptt","無名wretch","pixnet"]},"lrunes":{"system":["Facebook","Threads","Instagram"],"personal":["vocus","others","suno"]}});
export const PUBLISHED_SOURCE_ENTRIES=Object.freeze({"loc":[],"lo3rwang":[{"uid":"e62b0fc7","name":"suno","label":"suno"},{"uid":"47dc42c2","name":"kkcity","label":"kkcity"},{"uid":"2e6241eb","name":"others","label":"其他"},{"uid":"8c55398d","name":"vocus","label":"方格子vocus"},{"uid":"d7a85670","name":"ptt","label":"ptt"},{"uid":"69dcacc1","name":"wretch","label":"無名wretch"},{"uid":"1ae7168c","name":"pixnet","label":"pixnet"}],"lrunes":[{"uid":"e1ce51d5","name":"vocus","label":"vocus"},{"uid":"52042f1b","name":"others","label":"others"},{"uid":"7175c3f0","name":"suno","label":"suno"}]});
// Existing physical Domain UIDs, captured during explicit Source publication.
// Do not assign UIDs to the loc virtual Universe/Galaxy/Default nodes.
export const PUBLISHED_SOURCE_DOMAINS=Object.freeze({
  lo3rwang:'5dfdb539',lrunes:'9d3452a3'
});
export const PUBLISHED_SOURCE_TAXONOMY=Object.freeze(Object.fromEntries(
  Object.entries(PUBLISHED_SOURCE_LISTS).map(([id,values])=>[
    id,sourceTaxonomyFromCatalog(values.system,PUBLISHED_SOURCE_ENTRIES[id]||[],{
      scopeId:id,universe:'loc',galaxy:'loc',
      domainUid:PUBLISHED_SOURCE_DOMAINS[id]||''
    })
  ])
));
export function publishedSourceTaxonomy(scopeId){
  return Object.prototype.hasOwnProperty.call(PUBLISHED_SOURCE_TAXONOMY,scopeId)
    ?PUBLISHED_SOURCE_TAXONOMY[scopeId]:null;
}
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
