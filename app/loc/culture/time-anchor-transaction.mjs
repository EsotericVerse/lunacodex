// Fixed TimeAnchor transaction. Never send tables, SQL, projections, filters,
// connection details or arbitrary SELECT structure to the website backend.
const UID=/^[A-Za-z0-9]{8}$/;
export async function readTimeAnchorTransaction(scope,{
  mode='public',cursor='',limit=2000,signal=null
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
  for(;;){
    const page=await readTimeAnchorTransaction(scope,{mode,cursor,limit:2000,signal});
    for(const row of page.rows){
      const uid=String(row?.uid||'');
      if(!uid||seen.has(uid))throw new Error('Invalid repeated TimeAnchor UID');
      seen.add(uid);all.push(row);
    }
    if(!page.nextCursor)return all;
    if(page.nextCursor===cursor||!page.rows.length)
      throw new Error('Invalid TimeAnchor continuation');
    cursor=page.nextCursor;
  }
}
