// Space ZModel: Trace.attr.path contains exact Path UIDs.
// Standalone Paths remain separate; location coordinates never imply a parent.
const key=row=>String(row?.source_scope||'')+':'+String(row?.uid||'');
export function traceRouteHierarchy(rows=[],scopeId=''){
  const list=(Array.isArray(rows)?rows:[]).filter(row=>
    (row?.trace_type==='path'||row?.trace_type==='trace')&&
    (!scopeId||row.source_scope===scopeId));
  const routes=new Map(list.filter(row=>row.trace_type==='path').map(row=>[key(row),row]));
  const parents=list.filter(row=>row.trace_type==='trace');
  const linked=new Set();
  const groups=parents.map(trace=>{
    const seen=new Set(),paths=[];
    for(const id of trace.route_list?.routes||[]){
      const route=routes.get(String(trace.source_scope||'')+':'+String(id||''));
      if(!route||seen.has(key(route)))continue;
      seen.add(key(route));linked.add(key(route));paths.push(route);
    }
    return {trace,paths};
  });
  const orphans=[...routes.values()].filter(row=>!linked.has(key(row)));
  return {groups,orphans};
}
