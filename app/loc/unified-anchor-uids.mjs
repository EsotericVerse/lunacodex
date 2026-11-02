import {selectAllRowsBounded} from './db-query.mjs';

// New Anchor UIDs are global to Time, Point, Keywords and Media within each
// Scope; the whole native *_anchor primary-key pool must be checked. Callers
// may pass an authenticated reader for imports or use the bounded shared scan.
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
