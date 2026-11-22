// Named fixed record/Anchor projections. All variable values are validated
// by the server against published Scope and ZModel model families.
async function readFixedOperation(operation,params,{signal=null,editor=false}={}){
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):
    AbortSignal.timeout(20000);
  const response=await fetch('/api/loc-public-query',{
    method:'POST',credentials:editor?'include':'omit',cache:'no-store',
    redirect:'error',headers:{accept:'application/json',
      'content-type':'application/json'},
    body:JSON.stringify({kind:'transaction',operation,...params,
      mode:editor?'editor':'public'}),signal:requestSignal
  });
  const json=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error('LOC '+operation+' failed (HTTP '+response.status+')');
    error.status=response.status;throw error;
  }
  if(!json?.data||json.transaction?.model!==operation)
    throw Error('Invalid LOC fixed model response');
  return json.data;
}
export const readGalaxyRecords=(params,options={})=>
  readFixedOperation('galaxy-records',params,{...options,
    editor:options.editor===true});
export const readAnchorFeature=(params,options={})=>
  readFixedOperation('anchor-feature',params,{...options,
    editor:options.editor===true});
export async function readAllAnchorFeature({scope,family,types,startDate,endDate,
  signal=null,editor=false}={}){
  const rows=[],seen=new Set();let cursor;
  for(;;){
    const data=await readAnchorFeature({scope,family,types,startDate,endDate,
      cursor,limit:1000},
      {signal,editor});
    for(const row of data.rows||[]){
      const uid=String(row.uid||'');
      if(!uid||seen.has(uid))throw Error('Duplicate Anchor UID');
      seen.add(uid);rows.push(row);
    }
    if(!data.nextCursor)return rows;
    if(data.nextCursor===cursor||!data.rows?.length)throw Error('Invalid Anchor continuation');
    cursor=data.nextCursor;
  }
}
