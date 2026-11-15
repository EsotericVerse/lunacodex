// Resolve only explicitly stored Trace relationships for bulk visibility edits.
// The plan is an operation, not a persisted hierarchy or depth flag.
const VALID_ID=/^[A-Za-z0-9]{4}$/;
const normalizeIds=list=>[...new Set((Array.isArray(list)?list:[]).flat(Infinity)
  .map(value=>String(value||'').trim()).filter(value=>VALID_ID.test(value)))];

export function planTraceVisibilityUids({maps=[],selectedUids=[],mode='self'}={}){
  if(!['self','routes','all'].includes(mode))throw Error('無效的批次顯示範圍');
  const byId=new Map(maps.filter(row=>['trace','path'].includes(row?.trace_type))
    .map(row=>[String(row.uid),row]));
  const selected=normalizeIds(selectedUids);
  if(selected.length!==new Set(selectedUids).size||
     selected.some(uid=>!byId.has(uid)))throw Error('批次清單包含不存在的路線或痕跡圖');
  const targets=new Set(selected);
  const routes=new Set();
  const addAnchors=row=>{
    for(const id of normalizeIds(row.anchor_list))targets.add(id);
  };
  if(mode!=='self'){
    for(const uid of selected){
      const row=byId.get(uid);
      if(row.trace_type!=='trace')continue;
      for(const routeUid of normalizeIds(row.route_list?.routes)){
        const route=byId.get(routeUid);
        if(!route||route.trace_type!=='path')
          throw Error('痕跡圖關聯的路線圖未載入，請重新整理後操作');
        targets.add(routeUid);
        routes.add(routeUid);
      }
    }
  }
  if(mode==='all'){
    for(const uid of selected)addAnchors(byId.get(uid));
    for(const uid of routes)addAnchors(byId.get(uid));
  }
  return [...targets];
}
