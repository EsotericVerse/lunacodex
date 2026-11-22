// The group/item selectors are presentation-only. They reuse the existing
// statistics metrics and never alter the source, Class, or keyword contracts.
const FAMILIES=Object.freeze(['time','space','keyword','source']);

export function comparisonMetricGroups(dimension,byFamily={}){
  return FAMILIES.filter(family=>dimension==='all'||dimension===family)
    .flatMap(family=>(byFamily[family]||[]).map((group,index)=>({
      key:family+':'+index,
      name:String(group.name||''),
      options:[group.item,...(group.items||[])].filter(Boolean)
    })).filter(group=>group.options.length>0));
}

export function selectedComparisonMetricGroup(groups=[],selectedId=''){
  return groups.find(group=>group.options.some(item=>item.id===selectedId))||groups[0]||null;
}

export function firstAvailableGroupMetric(group,usedIds=new Set()){
  return (group?.options||[]).find(item=>!usedIds.has(item.id))?.id||'';
}
