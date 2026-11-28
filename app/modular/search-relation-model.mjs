import {galaxyInterNetEdges} from '../../packages/zenstack/galaxy-inter-net.mjs';
const UID=/^[A-Za-z0-9]{8}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const families=[['relation','文章','#84aaff'],['space','空間','#58caba'],['time','時間','#c1a6f5'],['statistics','統計','#e5b56e'],['source','來源','#b5bcc9'],['url','外部網址','#f195ac']];
export function searchRelationGroups(row,keywordCount=null){
  if(!UID.test(String(row?.uid||'')))return [];
  const groups=new Map(families.map(([id,label,color])=>[id,{id,label,color,items:[]}]));
  const seen=new Set();
  const add=(group,id,label,action=null)=>{
    const key=group+':'+id;if(seen.has(key))return;seen.add(key);
    groups.get(group).items.push({id:key,label:String(label||''),action});
  };
  const day=String(row.article_day||row.date||'').slice(0,10),federated=row.inter_net_federated===true;
  const edges=galaxyInterNetEdges(row,{place:row.trace_place,relatedTitles:row.relation_titles,federated}).branches;
  if(!federated){
    for(const edge of edges.relation)add('relation',edge.field+':'+edge.value,
      ({source_id:'上筆',ref_id:'參考',target_id:'下筆'}[edge.field]||'文章')+' · '+(edge.label||edge.value),
      {kind:'galaxy',uid:edge.value});
    const space=row.related_space||{};
    const place=space.place||row.trace_place;
    if(UID.test(String(place?.uid||'')))add('space',place.uid,place.title||'地點',{kind:'feature',feature:'trace',navigation:{place:place.uid}});
    for(const item of [...(space.routes||[]),...(space.traces||[])])
      if(UID.test(String(item.uid||'')))add('space',item.uid,item.title,{kind:'feature',feature:'trace',navigation:{map:item.uid}});
    if(!place&&row.location)add('space','literal',row.location);
    if(DAY.test(day)){
      add('time','date',day,{kind:'feature',feature:'culture',navigation:{from:day,to:day}});
      for(const [type,items] of [['lucus',row.related_time?.lucus],['period',row.related_time?.periods],['era',row.related_time?.eras]])
        for(const item of items||[])if(UID.test(String(item.uid||'')))
          add('time',item.uid,item.title,{kind:'feature',feature:'culture',navigation:{from:day,to:day,[type==='lucus'?'lucus':'period']:item.uid}});
      add('statistics','keywords',keywordCount===null?'關鍵詞分佈':('公開詞彙命中 '+keywordCount+' 種'),
        {kind:'feature',feature:'statics',navigation:{statTab:'keywords',from:day,to:day}});
      for(const [key,label] of [['week','當週統計'],['year','當年統計']]){
        const range=row.related_statistics?.[key];
        if(range?.start&&range?.end)add('statistics',key,label,
          {kind:'feature',feature:'statics',navigation:{statTab:'charts',from:range.start,to:range.end}});
      }
    }
  }
  if(row.site)add('source','site',row.site);
  if(row.extract===true&&!federated)for(const link of row.links||[]){
    try{const url=new URL(link.href);if(!['https:','http:'].includes(url.protocol))continue;
      add('url',url.href,link.label+' · '+url.hostname,{kind:'external',href:url.href});
    }catch{}
  }
  return [...groups.values()].filter(group=>group.items.length);
}
export function relationGraph(groups,expanded,title){
  const nodes=[{id:'root',label:String(title||'本文').slice(0,32),kind:'root',level:0,shape:'ellipse'}],edges=[];
  for(const group of groups){
    const id='branch:'+group.id;
    nodes.push({id,label:group.label+' '+group.items.length,kind:'branch',level:1,shape:'box',colorKey:group.color});
    edges.push({id:'root>'+id,from:'root',to:id,colorKey:group.color});
    if(expanded===group.id)for(const item of group.items.slice(0,24)){
      nodes.push({id:item.id,label:item.label.slice(0,44),kind:'leaf',level:2,shape:'box',colorKey:group.color});
      edges.push({id:id+'>'+item.id,from:id,to:item.id,colorKey:group.color});
    }
  }
  return {nodes,edges};
}
