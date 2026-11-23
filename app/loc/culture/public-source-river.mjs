// Public Culture's second river projects existing daily SQL aggregates onto the
// saved LOC Source UIDs. Only visible nodes are materialized as vis-timeline
// groups; expanding a level never requests or retains article identities.
import {assignedSource} from '../statistics/member-intersection-model.mjs';
import {buildCultureSourceTreeLanes,rollupCultureSourceDays} from './source-tree-lanes.mjs';

export function publicCultureSourceModel(rows=[],taxonomy={},expandedUids=[],start='',end=''){
  const tree=Array.isArray(taxonomy?.tree)?taxonomy.tree:[];
  const byUid=new Map(tree.map(node=>[node.uid,node]));
  const sourceTotals=new Map();
  const daily=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const site=String(row?.site||'').trim();
    const day=String(row?.day||row?.start_date||'').slice(0,10);
    const count=Math.max(0,Number(row?.item_count)||0);
    if(!site||!day||!count||(start&&day<start)||(end&&day>end))continue;
    daily.push({start_date:day,category:site,item_count:count});
    sourceTotals.set(site,(sourceTotals.get(site)||0)+count);
  }
  const grouped=new Map(),unmatched=[];
  for(const [site,count] of sourceTotals){
    const uid=assignedSource(site,taxonomy?.aliases||[],taxonomy?.categories||[]);
    const node=byUid.get(uid);
    if(!node){
      unmatched.push(site);
      continue;
    }
    if(!grouped.has(uid))grouped.set(uid,{
      key:node.root+':'+uid,sites:[],item_count:0
    });
    const entry=grouped.get(uid);
    entry.sites.push(site);
    entry.item_count+=count;
  }
  const classified=[...grouped.values()];
  if(unmatched.length)classified.push({
    key:'custom:others',sites:unmatched,
    item_count:unmatched.reduce((sum,site)=>sum+sourceTotals.get(site),0)
  });
  const hierarchy=buildCultureSourceTreeLanes(taxonomy,classified,expandedUids);
  const rolled=rollupCultureSourceDays(daily,classified,taxonomy);
  const byNode=new Map();
  let largest=1;
  for(const [key,count] of rolled.days){
    const split=key.indexOf('\u0000');
    if(split<0)continue;
    const uid=key.slice(0,split),day=key.slice(split+1);
    if(!byNode.has(uid))byNode.set(uid,[]);
    byNode.get(uid).push({day,count});
    largest=Math.max(largest,count);
  }
  const groups=[],items=[],sites=[];
  for(const [order,node] of hierarchy.visible.entries()){
    const id=node.groupId;
    groups.push({
      id,label:node.label+' ('+node.item_count+')',
      depth:node.level,order,collapsible:node.collapsible,
      expanded:node.expanded,selectable:node.selectable,
      className:node.level?'scope-dual-river-child':'scope-dual-river-root'
    });
    if(node.selectable&&node.sites.length){
      sites.push({key:id,site:node.label,label:node.label,
        sites:node.sites,count:node.item_count});
    }
    const uid=node.uid||'unassigned';
    for(const {day,count} of byNode.get(uid)||[]){
      items.push({id:id+':'+day,entry_type:'source_total',group_key:id,
        group_label:node.label,start_date:day,item_count:count,
        density_ratio:count/largest,display_label:'',
        title:day+' · '+node.label+' · '+count});
    }
  }
  return {groups,items,sites};
}
