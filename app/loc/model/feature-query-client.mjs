import {queryGalaxyRecords} from '../actions/galaxy/queries.mjs';
import {queryAnchorFeature} from '../actions/anchor/queries.mjs';
import {queryPublicSearchPatternIndex} from '../actions/search/patterns.mjs';
import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS,createTextAdaptiveRows} from '../query/query-batch-size.mjs';
// Named fixed record/Anchor projections. All variable values are validated
// by the server against published Scope and ZModel model families.
async function readFixedOperation(operation,params,{signal=null,editor=false}={}){
  const body={kind:'query',operation,...params,mode:editor?'editor':'public'};
  const json=operation==='galaxy-records'
    ?await queryGalaxyRecords(body):await queryAnchorFeature(body);
  if(!json?.data||json.query?.model!==operation)
    throw Error('Invalid LOC fixed model response');
  return json.data;
}
export const readGalaxyRecords=(params,options={})=>
  readFixedOperation('galaxy-records',params,{...options,
    editor:options.editor===true});
export const readAnchorFeature=(params,options={})=>
  readFixedOperation('anchor-feature',params,{...options,
    editor:options.editor===true});
export const readPublicSearchPatternIndex=scopeIds=>
  queryPublicSearchPatternIndex({scopeIds});
export async function readAllAnchorFeature({scope,family,types,startDate,endDate,
  signal=null,editor=false}={}){
  const rows=[],seen=new Set();let cursor;
  const batch=createTextAdaptiveRows({initial:MAX_ROWS,maximum:TIME_ANCHOR_MAX_PAGE_ROWS});
  for(;;){
    const data=await readAnchorFeature({scope,family,types,startDate,endDate,
      cursor,limit:batch.size},
      {signal,editor});
    for(const row of data.rows||[]){
      const uid=String(row.uid||'');
      if(!uid||seen.has(uid))throw Error('Duplicate Anchor UID');
      seen.add(uid);rows.push(row);
    }
    if(!data.nextCursor)return rows;
    batch.observe(data.rows.length,data.rows.reduce((n,row)=>n+JSON.stringify(row).length,0));
    if(data.nextCursor===cursor||!data.rows?.length)throw Error('Invalid Anchor continuation');
    cursor=data.nextCursor;
  }
}
