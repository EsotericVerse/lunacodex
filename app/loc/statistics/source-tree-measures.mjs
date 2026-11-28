import {sourceOutlineOptions} from '../source/outline-options.mjs';

// Multiple-item statistics use the ONLY Source taxonomy:
// silver.loc_lucus.attr.uid: Universe > Galaxy > Domain > From (site).
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
  // Domain/Galaxy/Universe are derived rollups, not site identities;
  // only Galaxy/Domain are selectable in the intersection picker.
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
  const childCounts=new Map(),descendantCounts=new Map(),fromCounts=new Map();
  for(const node of outline){
    const parent=node.path.at(-2);
    if(parent)childCounts.set(parent,(childCounts.get(parent)||0)+1);
    for(const ancestor of node.path.slice(0,-1))
      descendantCounts.set(ancestor,(descendantCounts.get(ancestor)||0)+1);
    if(node.type==='from')
      for(const ancestor of node.path)
        fromCounts.set(ancestor,(fromCounts.get(ancestor)||0)+1);
  }
  const metrics=outline.map(node=>({
    id:sourceTreeMetricId(node.code),kind:'source_tree',uid:node.code,
    parentUid:node.path.at(-2)||null,
    path:node.path,level:node.level,type:node.type,
    name:node.label,total:totals.get(sourceTreeMetricId(node.code))||0,
    childCount:childCounts.get(node.code)||0,
    descendantCount:descendantCounts.get(node.code)||0,
    fromCount:fromCounts.get(node.code)||0
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

// Intersection navigation starts at each Universe heading, then exposes only
// Galaxy and Domain. From nodes stay inside metricIdsForSite rollups, never
// appear as selectable or displayed rows in this two-level chooser.
// Follow persisted Lucus parent UIDs, never guess a path from source names.
export function sourceIntersectionOutline(metrics=[]){
  const nodes=(Array.isArray(metrics)?metrics:[])
    .filter(node=>node?.kind==='source_tree');
  const children=new Map();
  for(const node of nodes){
    if(!node.parentUid)continue;
    const siblings=children.get(node.parentUid)||[];
    siblings.push(node);
    children.set(node.parentUid,siblings);
  }
  const withDomains=galaxy=>({...galaxy,
    domains:(children.get(galaxy.uid)||[]).filter(node=>node.type==='domain')});
  const groups=nodes.filter(node=>node.type==='universe'&&!node.parentUid)
    .map(universe=>({
      uid:universe.uid,name:universe.name,
      galaxies:(children.get(universe.uid)||[])
        .filter(node=>node.type==='galaxy').map(withDomains),
      domains:[]
    }));
  // An absent Universe or Galaxy is NOT a reason to drop its child. Keep
  // separate unmatched-level sections, without manufacturing an Lucus UID.
  const orphanGalaxies=nodes.filter(node=>node.type==='galaxy'&&
    node.path?.length===1).map(withDomains);
  const orphanDomains=nodes.filter(node=>node.type==='domain'&&
    node.path?.length===1);
  if(orphanGalaxies.length||orphanDomains.length)
    groups.push({uid:'__unclassified__',name:'未分類',
      galaxies:orphanGalaxies,domains:orphanDomains});
  return groups;
}
