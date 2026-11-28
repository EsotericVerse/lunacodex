import {spaceCoordinates} from './space-graph.mjs';

// Public two-point preview is in-memory only and has no database write path.
export function pickTraceDemoStop(current,lucus,scopeId){
  const ids=Array.isArray(current)?current:[];
  if(ids.length>=2||!lucus||lucus.trace_type!=='space_lucus'||
    lucus.source_scope!==scopeId||!spaceCoordinates(lucus)||
    !/^[A-Za-z0-9]{4}$/.test(String(lucus.uid||''))||
    ids.includes(lucus.uid))return ids;
  return [...ids,lucus.uid];
}
export function traceDemoRoute(ids,lucus,scopeId){
  if(!Array.isArray(ids)||ids.length!==2||ids[0]===ids[1])return null;
  const selected=ids.map(uid=>(lucus||[]).find(lucus=>
    lucus.uid===uid&&lucus.source_scope===scopeId&&lucus.trace_type==='space_lucus'));
  if(selected.some(row=>!row||!spaceCoordinates(row)))return null;
  return {uid:'DEMO',trace_type:'path',source_scope:scopeId,
    title:'兩點路線試玩（不儲存）',lucus_list:[...ids]};
}
