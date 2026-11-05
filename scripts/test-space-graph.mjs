import test from 'node:test';
import assert from 'node:assert/strict';
import {SPACE_ANCHOR,SPACE_PERIOD,SPACE_TRACE,BASE62_FOUR,BASE62_UID,spaceType,
  spaceCoordinates,spaceRouteIds,resolveSpaceGraph} from '../app/modular/features/trace/space-graph.mjs';

const scope='lo3rwang';
const point=(id,coords=null)=>({id,source_scope:scope,type:SPACE_ANCHOR,
  title:id,address:coords,description:id+' 地址'});
const route=(id,ids)=>({id,source_scope:scope,type:SPACE_PERIOD,
  title:id,anchor_list:ids});
const trace=(id,ids)=>({id,source_scope:scope,type:SPACE_TRACE,
  title:id,anchor_list:ids});
const a=point('a001',[121.5,25.1]),b=point('A001',[121.4,25.2]),
  c=point('B002'),d=point('C003',[120.3,22.6]);
const r1=route('R001',['a001','A001','B002']),r2=route('R002',['a001','C003']);
const t1=trace('T001',['R001','R002']);
const all=[a,b,c,d,r1,r2,t1];

test('Base62 IDs remain case-sensitive; location arrays accept real coords but not missing GPS',()=>{
  assert.equal(BASE62_FOUR.test('a001'),true);
  assert.equal(BASE62_FOUR.test('A001'),true);
  assert.notEqual('a001','A001');
  assert.deepEqual(spaceCoordinates(a),[121.5,25.1]);
  assert.equal(spaceCoordinates(c),null);
  assert.deepEqual(spaceCoordinates({longitude:120.3,latitude:22.1}),[120.3,22.1]);
  assert.equal(spaceCoordinates({longitude:null,latitude:null}),null);
  assert.equal(spaceCoordinates({address:[999,35]}),null);
  assert.equal(spaceType({trace_type:'anchor'}),SPACE_ANCHOR);
  assert.equal(spaceType({trace_type:'map'}),SPACE_PERIOD);
  assert.equal(spaceType({trace_type:'path'}),SPACE_PERIOD);
});

test('selecting multiple places creates only points, no guessed lines',()=>{
  const graph=resolveSpaceGraph(['a001','A001','B002'],all,{scopeId:scope});
  assert.deepEqual(graph.points.map(p=>p.id),['a001','A001','B002']);
  assert.deepEqual(graph.lines,[]);
  assert.equal(graph.points[2].coordinates,null);
});

test('one explicitly saved route connects only adjacent stops',()=>{
  const graph=resolveSpaceGraph(r1,all);
  assert.deepEqual(graph.lines.map(edge=>[edge.from,edge.to]),
    [['a001','A001'],['A001','B002']]);
  assert.equal(graph.routes.length,1);
});

test('one two-stop route is one valid visible connection',()=>{
  const graph=resolveSpaceGraph(route('R003',['a001','B002']),all);
  assert.deepEqual(graph.lines.map(edge=>[edge.from,edge.to]),[['a001','B002']]);
});

test('trace composes routes without bridging the end of one to the next',()=>{
  const graph=resolveSpaceGraph(t1,all);
  assert.deepEqual(graph.lines.map(edge=>[edge.from,edge.to,edge.routeId]),
    [['a001','A001','R001'],['A001','B002','R001'],['a001','C003','R002']]);
  assert.deepEqual(graph.points.map(point=>point.id),['a001','A001','B002','C003']);
  assert.deepEqual(spaceRouteIds(t1,all),['a001','A001','B002','C003']);
  assert.equal(graph.missing.length,0);
});

test('missing points never create a phantom line, and foreign Scope cannot connect',()=>{
  const foreign=point('D004',[130,30]);foreign.source_scope='lrunes';
  const graph=resolveSpaceGraph(route('R004',['a001','D004','A001']),[...all,foreign]);
  assert.deepEqual(graph.lines,[]);
  assert.deepEqual(graph.missing,['D004']);
  const invalid=resolveSpaceGraph(trace('T002',['R001','X999']),all);
  assert.deepEqual(invalid.missing,['X999']);
});

test('legacy Frame queues remain readable without rewriting historic IDs',()=>{
  const oldA={uid:'1A2B3C4D',source_scope:scope,trace_type:'anchor',
    longitude:121.1,latitude:23.3,title:'old'};
  const oldB={uid:'5E6F7G8H',source_scope:scope,trace_type:'anchor',
    longitude:120.1,latitude:24.3,title:'old2'};
  const oldRoute={uid:'9A9B9C9D',source_scope:scope,trace_type:'map',
    anchor_list:[oldA.uid,oldB.uid]};
  const graph=resolveSpaceGraph(oldRoute,[oldA,oldB]);
  assert.deepEqual(graph.lines.map(x=>[x.from,x.to]),[[oldA.uid,oldB.uid]]);
});


test('historical route queues read anchor_uids until the DB cutover',()=>{
  const legacy={uid:'MAP00001',source_scope:scope,trace_type:'map',anchor_uids:['a001','A001']};
  const graph=resolveSpaceGraph(legacy,[a,b]);
  assert.deepEqual(graph.lines.map(x=>[x.from,x.to]),[['a001','A001']]);
});

test('mixed old and new member fields do not bridge missing route stops',()=>{
  const historical={uid:'OLD00001',source_scope:scope,trace_type:'map',
    anchor_uids:['a001','MISSING','A001']};
  const graph=resolveSpaceGraph(historical,all);
  assert.deepEqual(graph.routes[0].nodes,['a001','MISSING','A001']);
  assert.deepEqual(graph.lines,[]);
  assert.deepEqual(graph.missing,['MISSING']);
});

test('eight-character anchor UIDs render saved route and Trace collections',async()=>{
  const p1=point('aa11BB22',[121.48,25.04]);
  const p2=point('Cc33Dd44',[121.50,25.05]);
  const p3=point('Ee55Ff66',[121.52,25.06]);
  const r=route('Gg77Hh88',[p1.id,p2.id,p3.id]);
  const collection={id:'Ii99Jj00',source_scope:scope,type:SPACE_TRACE,
    title:'saved',anchor_list:[],route_list:{routes:[r.id],segments:[]}};
  assert.equal(BASE62_UID.test(p1.id),true);
  assert.deepEqual(spaceRouteIds(r),[p1.id,p2.id,p3.id]);
  const routes=resolveSpaceGraph(r,[p1,p2,p3,r],{scopeId:scope});
  assert.equal(routes.points.length,3);
  assert.deepEqual(routes.lines.map(line=>[line.from,line.to]),[[p1.id,p2.id],[p2.id,p3.id]]);
  const composed=resolveSpaceGraph(collection,[p1,p2,p3,r,collection],{scopeId:scope});
  assert.equal(composed.routes.length,1);
  assert.equal(composed.lines.length,2);
  assert.deepEqual(composed.missing,[]);
  const {spaceGraphGeojson}=await import('../app/modular/features/trace/space-graph-geojson.mjs');
  const geo=spaceGraphGeojson(collection,[p1,p2,p3,r,collection],{scopeId:scope});
  assert.equal(geo.features.filter(f=>f.geometry.type==='LineString').length,2);
});

test('LOC published collection preserves eight-character trace pair references',async()=>{
  const {publicTraceMapChoices}=await import('../app/modular/features/trace/trace-map-choices.mjs');
  const item={uid:'Rr88Ss99',source_scope:scope,trace_type:'trace',
    route_list:{routes:[],segments:[['Aa11Bb22','Cc33Dd44']]}};
  const options=publicTraceMapChoices([item],'loc');
  assert.equal(options.length,1);
  assert.deepEqual(options[0].route_list.segments,[['Aa11Bb22','Cc33Dd44']]);
});
