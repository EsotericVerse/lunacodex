import {traceRouteHierarchy} from './trace-route-hierarchy.mjs';

const key=row=>String(row?.source_scope||'')+':'+String(row?.uid||'');
const validUid=/^[A-Za-z0-9]{8}$/;

export function buildTraceTerritoryRouteModel(rows=[],selectedTraceKey='',selectedPathKey=''){
  const hierarchy=traceRouteHierarchy(rows);
  const traceOptions=[
    ...hierarchy.groups.map(group=>({
      key:key(group.trace),
      label:String(group.trace.source_scope||'')+' · '+String(group.trace.title||group.trace.uid)
    })),
    ...(hierarchy.orphans.length?[{key:'__standalone__',label:'未歸屬路徑圖'}]:[])
  ];
  const activeTraceKey=traceOptions.some(row=>row.key===selectedTraceKey)
    ?selectedTraceKey:traceOptions[0]?.key||'';
  const currentGroup=hierarchy.groups.find(group=>key(group.trace)===activeTraceKey)||null;
  const routeOptions=currentGroup?.paths||hierarchy.orphans;
  const activePath=routeOptions.find(row=>key(row)===selectedPathKey)||null;
  const selected=activePath||(currentGroup?.trace||routeOptions[0]||null);
  const referencedRoutes=currentGroup?.trace===selected?currentGroup.paths:[];
  const maps=selected?[selected,...referencedRoutes.filter(row=>key(row)!==key(selected))]:[];
  const memberUids=[...new Set(maps.flatMap(row=>
    (Array.isArray(row?.lucus_list)?row.lucus_list.flat(Infinity):[])
      .map(uid=>String(uid||'').trim()).filter(uid=>validUid.test(uid))
  ))];
  return {hierarchy,traceOptions,activeTraceKey,currentGroup,routeOptions,
    activePath,selected,maps,memberUids};
}
