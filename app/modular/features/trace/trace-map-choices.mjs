// LOC displays a read-only union of published, saved route relationships.
// Never infer visits, join unrelated routes, or expose hidden source records.
export function publicTraceMapChoices(rows=[],scopeId='loc'){
  const saved=(Array.isArray(rows)?rows:[]).filter(row=>
    (row?.trace_type==='path'||row?.trace_type==='trace')&&
    (scopeId==='loc'||row?.source_scope===scopeId));
  if(scopeId!=='loc')return saved;
  // Surface individual saved routes first: the homepage renders only one
  // selected path, never the union of every Scope's points on startup.
  const individual=saved.filter(row=>row.trace_type==='path');
  const unions=[...new Set(saved.map(row=>row.source_scope).filter(Boolean))].flatMap(source=>{
    const own=saved.filter(row=>row.source_scope===source);
    const routes=own.filter(row=>row.trace_type==='path');
    const routeById=new Map(routes.map(row=>[row.uid,row]));
    const routeIds=new Set(routes.map(row=>row.uid));
    const seenPairs=new Set(),pairs=[];
    for(const trace of own.filter(row=>row.trace_type==='trace')){
      for(const uid of trace.route_list?.routes||[])if(routeById.has(uid))routeIds.add(uid);
      for(const pair of trace.route_list?.segments||[]){
        if(!Array.isArray(pair)||pair.length!==2||pair[0]===pair[1]||
          pair.some(uid=>!/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(uid))))continue;
        const key=pair.join(':');
        if(!seenPairs.has(key)){seenPairs.add(key);pairs.push(pair);}
      }
    }
    if(!routeIds.size&&!pairs.length)return [];
    return [{uid:'LOC_UNION',trace_type:'trace',source_scope:source,
      title:'痕跡圖聯集',description:'',anchor_list:[...new Set(pairs.flat())],route_list:{routes:[...routeIds],segments:pairs},
      read_only:true}];
  });
  // The legacy LOC union remains available only as an explicit selection.
  return [...individual,...unions];
}
