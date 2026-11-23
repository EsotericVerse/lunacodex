import {traceRouteHierarchy} from '../../modular/features/trace/trace-route-hierarchy.mjs';

// Presentation-only Space hierarchy. Persisted Trace -> Path and Path -> Point
// references remain explicit and ordered; location, coordinate and title do
// not imply membership. A shared Path/Point may appear in multiple branches.
const uid=row=>String(row?.uid||'');
const ids=list=>Array.isArray(list)?[...new Set(list.flat(Infinity).map(String).filter(Boolean))]:[];

export function spaceRecordHierarchy(spatial={},scopeId=''){
  const belongs=row=>!scopeId||row?.source_scope===scopeId;
  const points=(spatial.anchors||[]).filter(row=>belongs(row)&&uid(row));
  const maps=(spatial.maps||[]).filter(belongs);
  const byPoint=new Map(points.map(row=>[uid(row),row]));
  const referenced=new Set();
  const resolvePoints=keys=>ids(keys).map(key=>byPoint.get(key)).filter(Boolean);
  const pathBranch=path=>{
    const members=resolvePoints(path.anchor_list);
    members.forEach(row=>referenced.add(uid(row)));
    return {row:path,points:members};
  };
  const hierarchy=traceRouteHierarchy(maps,scopeId);
  const traces=hierarchy.groups.map(group=>{
    const paths=group.paths.map(pathBranch);
    const included=new Set(paths.flatMap(path=>path.points.map(uid)));
    // Trace.attr.point represents its own direct line segments, not every
    // Point in an included Path. Show only direct, nonduplicate members here.
    const directPoints=resolvePoints(group.trace.anchor_list)
      .filter(row=>!included.has(uid(row)));
    directPoints.forEach(row=>referenced.add(uid(row)));
    return {row:group.trace,paths,directPoints};
  });
  const unclassifiedPaths=hierarchy.orphans.map(pathBranch);
  const unclassifiedPoints=points.filter(row=>!referenced.has(uid(row)));
  return {traces,unclassifiedPaths,unclassifiedPoints};
}
