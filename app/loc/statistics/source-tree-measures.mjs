import {sourceOutlineOptions} from '../source/outline-options.mjs';

// Multiple-item statistics use the ONLY Source taxonomy:
// silver.loc_anchor.attr.uid: Universe > Galaxy > Domain > From (site).
// Galaxy.site is a platform label; Galaxy.site_id is the native post ID,
// and Galaxy.media_link is an array of URL strings. Neither is a source UID.
const SEP=String.fromCharCode(0);
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export const SOURCE_UNCLASSIFIED_METRIC='source_unclassified'+SEP+'others';
export const sourceTreeMetricId=uid=>'source_tree'+SEP+uid;

export function sourceStatisticsTree(rows=[],taxonomy={}){
  const outline=sourceOutlineOptions(taxonomy);
  const byUid=new Map((taxonomy?.tree||[]).map(node=>[node.uid,node]));
  // Only an unambiguous published From (site) can identify a Galaxy.site.
  // Domain/Galaxy/Universe IDs are SELECTABLE rollups, not site identities.
  const fromAliases=new Map((taxonomy?.aliases||[])
    .filter(alias=>byUid.get(alias.category_code)?.type==='from')
    .map(alias=>[norm(alias.source_key),alias.category_code]));
  const totals=new Map(),sitePaths=new Map();
  const pathForSite=site=>{
    const key=norm(site);
    if(sitePaths.has(key))return sitePaths.get(key);
    const from=byUid.get(fromAliases.get(key));
    const ids=from?.type==='from'&&Array.isArray(from.path)&&from.path.length===4
      ?[...new Set(from.path)].map(sourceTreeMetricId)
      :[SOURCE_UNCLASSIFIED_METRIC];
    sitePaths.set(key,ids);
    return ids;
  };
  for(const row of rows||[]){
    if(row?.kind!=='source')continue;
    const count=Math.max(0,Number(row.item_count)||0);
    if(!count)continue;
    // Roll each real article source up its saved ancestor UID chain ONCE.
    // Parent and child can be compared as separate lanes without adding
    // overlapping totals together into a fabricated new category.
    for(const id of pathForSite(row.category))
      totals.set(id,(totals.get(id)||0)+count);
  }
  const metrics=outline.map(node=>({
    id:sourceTreeMetricId(node.code),kind:'source_tree',uid:node.code,
    parentUid:node.path.at(-2)||null,
    path:node.path,level:node.level,type:node.type,
    name:node.label,total:totals.get(sourceTreeMetricId(node.code))||0
  }));
  const unmatched=totals.get(SOURCE_UNCLASSIFIED_METRIC)||0;
  if(unmatched)metrics.push({
    id:SOURCE_UNCLASSIFIED_METRIC,kind:'source_unclassified',
    uid:null,parentUid:null,path:[],level:0,type:'unclassified',
    name:'未分類來源',total:unmatched
  });
  return {metrics,metricIdsForSite:pathForSite,
    // These are presentation totals, never independent SQL statistics.
    totals};
}
