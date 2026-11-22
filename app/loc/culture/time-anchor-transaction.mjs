// Fixed TimeAnchor transaction. Never send tables, SQL, projections, filters,
// connection details or arbitrary SELECT structure to the website backend.
import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS,createTextAdaptiveRows} from '../query/query-batch-size.mjs';
const UID=/^[A-Za-z0-9]{8}$/;
export async function readTimeAnchorTransaction(scope,{
  mode='public',cursor='',limit=MAX_ROWS,signal=null
}={}){
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):
    AbortSignal.timeout(20000);
  const response=await fetch('/api/loc-public-query',{
    method:'POST',credentials:mode==='editor'?'include':'omit',
    cache:'no-store',redirect:'error',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({kind:'transaction',operation:'time-anchors',
      scope,mode,cursor,limit}),signal:requestSignal
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error('TimeAnchor transaction failed (HTTP '+response.status+')');
    error.status=response.status;throw error;
  }
  if(!Array.isArray(payload?.data)||payload.data.length>limit||
     payload.nextCursor!=null&&!UID.test(String(payload.nextCursor)))
    throw new Error('Invalid TimeAnchor transaction response');
  return {rows:payload.data,nextCursor:payload.nextCursor||null};
}
export async function readAllTimeAnchorTransactions(scope,{
  mode='public',signal=null
}={}){
  const all=[],seen=new Set();let cursor='';
  const batch=createTextAdaptiveRows({initial:MAX_ROWS,maximum:TIME_ANCHOR_MAX_PAGE_ROWS});
  for(;;){
    const page=await readTimeAnchorTransaction(scope,{mode,cursor,limit:batch.size,signal});
    for(const row of page.rows){
      const uid=String(row?.uid||'');
      if(!uid||seen.has(uid))throw new Error('Invalid repeated TimeAnchor UID');
      seen.add(uid);all.push(row);
    }
    if(!page.nextCursor)return all;
    batch.observe(page.rows.length,page.rows.reduce((sum,row)=>sum+JSON.stringify(row).length,0));
    if(page.nextCursor===cursor||!page.rows.length)
      throw new Error('Invalid TimeAnchor continuation');
    cursor=page.nextCursor;
  }
}
