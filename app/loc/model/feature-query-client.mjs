import {queryGalaxyRecords} from '../actions/galaxy/queries.mjs';
import {queryLucusFeature} from '../actions/lucus/queries.mjs';
import {queryPublicSearchPatternIndex} from '../actions/search/patterns.mjs';
import {MAX_ROWS,TIME_LUCUS_MAX_PAGE_ROWS,createTextAdaptiveRows} from '../query/query-batch-size.mjs';
// Named fixed record/Lucus projections. All variable values are validated
// by the server against published Scope and ZModel model families.
// Server Actions do not accept a browser AbortSignal: cancellation here is a
// client-side stale-result guard; an already-dispatched server read may finish.
async function readFixedOperation(operation,params,{signal=null,editor=false}={}){
  if(signal?.aborted){const error=new Error('The operation was aborted');error.name='AbortError';throw error;}
  const body={kind:'query',operation,...params,mode:editor?'editor':'public'};
  const json=operation==='galaxy-records'
    ?await queryGalaxyRecords(body):await queryLucusFeature(body);
  if(signal?.aborted){const error=new Error('The operation was aborted');error.name='AbortError';throw error;}
  if(!json?.data||json.query?.model!==operation)
    throw Error('Invalid LOC fixed model response');
  return json.data;
}
export const readGalaxyRecords=(params,options={})=>
  readFixedOperation('galaxy-records',params,{...options,
    editor:options.editor===true});
export const readLucusFeature=(params,options={})=>
  readFixedOperation('lucus-feature',params,{...options,
    editor:options.editor===true});
export const readPublicSearchPatternIndex=scopeIds=>
  queryPublicSearchPatternIndex({scopeIds});
export async function readAllLucusFeature({scope,family,types,startDate,endDate,
  signal=null,editor=false}={}){
  const rows=[],seen=new Set();let cursor;
  const batch=createTextAdaptiveRows({initial:MAX_ROWS,maximum:TIME_LUCUS_MAX_PAGE_ROWS});
  for(;;){
    const data=await readLucusFeature({scope,family,types,startDate,endDate,
      cursor,limit:batch.size},
      {signal,editor});
    for(const row of data.rows||[]){
      const uid=String(row.uid||'');
      if(!uid||seen.has(uid))throw Error('Duplicate Lucus UID');
      seen.add(uid);rows.push(row);
    }
    if(!data.nextCursor)return rows;
    batch.observe(data.rows.length,data.rows.reduce((n,row)=>n+JSON.stringify(row).length,0));
    if(data.nextCursor===cursor||!data.rows?.length)throw Error('Invalid Lucus continuation');
    cursor=data.nextCursor;
  }
}
