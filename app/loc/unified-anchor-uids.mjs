import {selectAllRowsBounded} from './db-query.mjs';

// Only call when creating new content. The unified store has one PRIMARY KEY
// across Time/Trace/Keywords/Media, even though feature lists remain kind-filtered.
// `reader` is accepted for backward compatibility with any external caller
// still passing its own page-reading closure; every in-repo call site now
// omits it and gets the shared, size-aware (sequential-or-parallel) scan of
// silver.lo3rwang_anchor below -- previously each of the three call sites
// (ArticleTimeAnchorAction, CultureTimelineEditor, Culture) duplicated the
// exact same reader closure.
export async function readUnifiedAnchorUids(table,reader=null,{pageSize=1000}={}){
  const matched=String(table||'').match(/^silver\.([a-z][a-z0-9]{0,14})_(?:time|anchor)$/);
  if(!matched)return [];
  const anchorTable='silver.'+matched[1]+'_anchor';
  if(!reader){
    const {rows}=await selectAllRowsBounded(anchorTable,{
      columns:'uid',orders:[{column:'uid',ascending:true}],pageSize,authenticated:true
    });
    return rows.map(item=>({uid:String(item.uid||'')}));
  }
  const rows=[];
  for(let offset=0;;offset+=pageSize){
    const page=await reader(anchorTable,offset,pageSize);
    if(!Array.isArray(page))throw Error('Cannot validate shared anchor UID pool');
    rows.push(...page.map(item=>({uid:String(item.uid||'')})));
    if(page.length<pageSize)break;
  }
  return rows;
}
