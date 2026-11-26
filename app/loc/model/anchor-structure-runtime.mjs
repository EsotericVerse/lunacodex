import {getOrLoadScopedRead} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';

// Only shared public structure survives the feature that asked for it.
// Date/Point/media rows and editor-authorized reads stay on the original path.
const STRUCTURE_TYPES=Object.freeze({
  source:ANCHOR_TYPE_GROUPS.source,time:['era','period'],space:['trace','path']
});
export async function readAnchorStructure(options,readAnchorPages,{browser=typeof window!=='undefined'}={}){
  const {scope,family,types,startDate,endDate,signal,editor}=options;
  signal?.throwIfAborted?.();
  const structural=STRUCTURE_TYPES[family];
  const selection=types===undefined?ANCHOR_TYPE_GROUPS[family]:types;
  const allowed=ANCHOR_TYPE_GROUPS[family];
  if(!browser||editor||startDate!==undefined||endDate!==undefined||!Array.isArray(structural)||!Array.isArray(allowed)||
    !Array.isArray(selection)||!selection.length||selection.length>12||
    selection.some(type=>!allowed.includes(type))||
    !/^[a-z][a-z0-9]{0,14}$/.test(String(scope||''))||
    (family==='source')!==(scope==='loc'))
    return readAnchorPages(options);
  if(new Set(selection).size!==selection.length)
    throw Error('Duplicate Anchor type selection');
  const parents=selection.filter(type=>structural.includes(type));
  if(!parents.length)return readAnchorPages(options);
  const leaves=selection.filter(type=>!structural.includes(type));
  const local=new AbortController();
  const abort=()=>local.abort(signal?.reason);
  if(signal?.aborted)abort();
  else signal?.addEventListener('abort',abort,{once:true});
  try{
    const shared=getOrLoadScopedRead('silver.'+scope+'_anchor',
      ['public-anchor-structure',family,parents],
      ({signal:sharedSignal})=>readAnchorPages({
        scope,family,types:parents,signal:sharedSignal
      }),{signal:local.signal});
    const [base,detail]=await Promise.all([
      shared,leaves.length?readAnchorPages({...options,types:leaves,signal:local.signal}):[]
    ]);
    signal?.throwIfAborted?.();
    const byType=new Map(selection.map(type=>[type,[]]));
    for(const row of [...base,...detail]){
      const group=byType.get(row.type);
      if(!group)throw Error('Unexpected Anchor type in structural response');
      group.push(row);
    }
    // Preserve the caller's semantic type order and the database order within
    // each type. Never turn an Anchor structure into UID-sorted presentation.
    const rows=selection.flatMap(type=>byType.get(type));
    if(new Set(rows.map(row=>String(row.uid))).size!==rows.length)
      throw Error('Duplicate Anchor UID');
    return rows;
  }finally{
    signal?.removeEventListener('abort',abort);
    local.abort();
  }
}
