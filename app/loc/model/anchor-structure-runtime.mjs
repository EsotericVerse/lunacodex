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
  const rows=[...base,...detail];
  if(new Set(rows.map(row=>String(row.uid))).size!==rows.length)
    throw Error('Duplicate Anchor UID');
  return rows.sort((a,b)=>a.uid<b.uid?-1:a.uid>b.uid?1:0);
}
