// LOC Culture is a one-year PREVIEW of member Scopes, not a second
// Scope-specific Time River. The parent lane is a scopeid; expanding it
// reveals only that Scope's source-density summaries already in memory.
const valueOf=value=>String(value||'').trim();
const countOf=value=>Math.max(0,Number(value)||0);
const nextDay=value=>{
  const day=valueOf(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
  const d=new Date(day+'T00:00:00Z');
  if(!Number.isFinite(d.getTime()))return '';
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};

export function buildLocCultureScopePreview({
  scopes=[],scopeRanges=[],sourceScopeGroups=[],sourceScopeRiverItems=[],expandedScopeIds=[],completedScopeIds=null
}={}){
  const scopeIds=[...new Set(scopes.map(scope=>valueOf(scope?.id||scope?.scope_id)).filter(Boolean))];
  const ids=new Set(scopeIds);
  const expanded=new Set(expandedScopeIds);
  const completed=Array.isArray(completedScopeIds)?new Set(completedScopeIds):null;
  const dailyByScope=new Map();
  for(const row of scopeRanges){
    const scope=valueOf(row?.scope_id),day=valueOf(row?.start_date).slice(0,10),count=countOf(row?.item_count);
    if(!ids.has(scope)||!nextDay(day)||!count)continue;
    const list=dailyByScope.get(scope)||[];
    list.push({day,count});
    dailyByScope.set(scope,list);
  }
  const groups=[],items=[];
  for(const [scopeOrder,scope] of scopeIds.entries()){
    const parent='loc-preview:'+scope;
    const order=scopeOrder*10000;
    const totals=dailyByScope.get(scope)||[];
    const total=totals.reduce((n,row)=>n+row.count,0);
    const maximum=Math.max(1,...totals.map(row=>row.count));
    const isExpanded=expanded.has(scope);
    groups.push({id:parent,label:scope+'（'+(completed&&!completed.has(scope)?'—':total.toLocaleString())+'）',
      order,collapsible:true,expanded:isExpanded,className:'scope-time-trace-parent'});
    for(const row of totals)items.push({
      id:parent+':'+row.day,entry_id:parent+':'+row.day,
      entry_type:'scope_density',scope_id:scope,
      group_key:parent,group_label:scope,group_order:order,
      start_date:row.day,end_date:nextDay(row.day),
      item_count:row.count,density_ratio:row.count/maximum,
      display_label:'',title:row.day+' · '+scope+' · '+row.count+' 篇'
    });
    if(!isExpanded)continue;
    const children=sourceScopeGroups.filter(row=>valueOf(row?.scope_id)===scope&&countOf(row?.item_count)>0)
      .sort((a,b)=>valueOf(a?.category).localeCompare(valueOf(b?.category)));
    for(const [index,child] of children.entries()){
      const code=valueOf(child.code),childKey=parent+':source:'+code,childOrder=order+index+1;
      groups.push({id:childKey,label:'　'+valueOf(child.category||code)+'（'+countOf(child.item_count).toLocaleString()+'）',
        order:childOrder,className:'scope-time-trace-child'});
      const childRows=sourceScopeRiverItems.filter(row=>valueOf(row?.scope_id)===scope&&valueOf(row?.source_code)===code);
      const childMax=Math.max(1,...childRows.map(row=>countOf(row.item_count)));
      for(const row of childRows){
        const day=valueOf(row?.start_date).slice(0,10),count=countOf(row?.item_count);
        if(!nextDay(day)||!count)continue;
        items.push({...row,id:childKey+':'+day,entry_id:childKey+':'+day,
          group_key:childKey,group_label:valueOf(child.category||code),
          group_order:childOrder,start_date:day,end_date:nextDay(day),
          density_ratio:count/childMax,display_label:'',
          title:day+' · '+scope+' / '+valueOf(child.category||code)+' · '+count+' 篇'});
      }
    }
  }
  return {items,groups,scopeIds};
}
