import {resolveSpaceGraph,spaceId,spaceScope} from './space-graph.mjs';

// A geographic *projection* of saved semantic relationships: no road snapping,
// polygon guessing or artificial coordinates. Reuse in React and in node tests.
export function spaceGraphGeojson(selection,records=[],options={}){
  if(!selection)return {type:'FeatureCollection',features:[]};
  const graph=resolveSpaceGraph(selection,records,options);
  const points=new Map(graph.points.map(p=>[p.id,p]));
  const features=[];
  // Each saved route keeps its own stop numbering (including shared places).
  for(const route of graph.routes){
    route.nodes.forEach((id,index)=>{
      const point=points.get(id);
      if(!point?.coordinates)return;
      features.push({type:'Feature',
        properties:{kind:'space_stop',route_id:route.id,order:index+1,
          uid:id,title:point.title,source_scope:spaceScope(point.record)},
        geometry:{type:'Point',coordinates:point.coordinates}});
    });
  }
  if(!graph.routes.length){
    for(const point of graph.points){
      if(!point.coordinates)continue;
      features.push({type:'Feature',
        properties:{kind:'space_lucus',order:0,uid:point.id,
          title:point.title,source_scope:spaceScope(point.record)},
        geometry:{type:'Point',coordinates:point.coordinates}});
    }
  }
  for(const edge of graph.lines){
    const from=points.get(edge.from),to=points.get(edge.to);
    if(!from?.coordinates||!to?.coordinates)continue;
    features.push({type:'Feature',
      properties:{kind:'saved-trace-segment',route_id:edge.routeId,order:edge.order+1},
      geometry:{type:'LineString',coordinates:[from.coordinates,to.coordinates]}});
  }
  return {type:'FeatureCollection',features};
}
