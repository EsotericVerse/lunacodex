'use client';

import {getOrLoadScopedRead} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {queryGalaxyRecords} from '../actions/galaxy/queries.mjs';
import {queryAnchorFeature} from '../actions/anchor/queries.mjs';
import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS,createTextAdaptiveRows} from '../query/query-batch-size.mjs';
// Named fixed record/Anchor projections. All variable values are validated
// by the server against published Scope and ZModel model families.
async function readFixedOperation(operation,params,{signal=null,editor=false}={}){
  signal?.throwIfAborted?.();
  const body={kind:'query',operation,...params,mode:editor?'editor':'public'};
  const json=operation==='galaxy-records'
    ?await queryGalaxyRecords(body):await queryAnchorFeature(body);
  signal?.throwIfAborted?.();
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
async function readAnchorPages({scope,family,types,startDate,endDate,
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

// Only shared public structure survives the feature that asked for it.
// Date/Point/media rows and editor-authorized reads stay on the original path.
const STRUCTURE_TYPES=Object.freeze({
  source:ANCHOR_TYPE_GROUPS.source,time:['era','period'],space:['trace','path']
});
export async function readAllAnchorFeature(options={}){
  const {scope,family,types,startDate,endDate,signal,editor}=options;
  signal?.throwIfAborted?.();
  const structural=STRUCTURE_TYPES[family];
  const selection=types===undefined?ANCHOR_TYPE_GROUPS[family]:types;
  const allowed=ANCHOR_TYPE_GROUPS[family];
  if(typeof window==='undefined'||editor||startDate||endDate||!structural||
    !Array.isArray(selection)||!selection.length||
    selection.some(type=>!allowed.includes(type))||
    !/^[a-z][a-z0-9]{0,14}$/.test(String(scope||''))||
    (family==='source')!==(scope==='loc'))
    return readAnchorPages(options);
  const parents=[...new Set(selection.filter(type=>structural.includes(type)))].sort();
  if(!parents.length)return readAnchorPages(options);
  const leaves=[...new Set(selection.filter(type=>!structural.includes(type)))];
  const shared=getOrLoadScopedRead('silver.'+scope+'_anchor',
    ['public-anchor-structure',family,parents],()=>readAnchorPages({
      scope,family,types:parents
    }));
  // Do not bind a shared request to a single consumer's cancellation signal.
  // The outgoing page discards its result; another page may already need it.
  const [base,detail]=await Promise.all([
    shared,leaves.length?readAnchorPages({...options,types:leaves}):[]
  ]);
  signal?.throwIfAborted?.();
  return [...base,...detail].sort((a,b)=>a.uid<b.uid?-1:a.uid>b.uid?1:0);
}
