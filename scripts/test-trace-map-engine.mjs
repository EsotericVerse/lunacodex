import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spaceCoordinates} from '../app/modular/features/trace/space-graph.mjs';

const engine=readFileSync(new URL('../app/modular/features/trace/trace-map-engine.js',import.meta.url),'utf8')
  .replace(/^import .*\n/gm,'')
  .replace(/setWorkerUrl\(new URL\([\s\S]*?\.toString\(\)\);/,'')
  .replace(/^export /gm,'');

function setup({anchors=[],onAnchorSelect=()=>{},load=true,onLocationPick=null,fetchImpl=globalThis.fetch}={}){
  const maps=[];
  class Bounds{
    constructor(){this.points=[];}
    extend(point){this.points.push(point);return this;}
  }
  class FakeMap {
    constructor(options){this.options=options;this.sources={};this.layers=[];
      this.callbacks={};this.bounds=[];this.fly=[];this.ease=[];
      this.center=options.center;maps.push(this);}
    addControl(){}
    once(name,fn){this.callbacks[name]=fn;}
    on(name,layer,fn){if(typeof layer==='function'){fn=layer;layer='';}
      this.callbacks[name+'|'+layer]=fn;}
    addSource(id,value){this.sources[id]={...value,setData:data=>{this.sources[id].data=data;}};}
    addLayer(value){this.layers.push(value);}
    getSource(id){return this.sources[id];}
    getContainer(){return {clientWidth:1200,clientHeight:800};}
    getCanvas(){return {clientWidth:1200,clientHeight:800,style:{cursor:''}};}
    project([lng,lat]){return {x:600+(lng-this.center[0])*1000,
      y:400+(lat-this.center[1])*1000};}
    fitBounds(bounds,options){this.bounds.push({points:bounds.points,options});}
    flyTo(options){this.fly.push(options);this.center=options.center;}
    easeTo(options){this.ease.push(options);this.center=options.center;}
    resize(){}
    remove(){this.removed=true;}
  }
  class Noop{}
  // MapLibre Popup uses a fluent API. Keep the fake semantically faithful,
  // rather than failing before our original-record and recenter assertions.
  class FakePopup {
    setLngLat(value){this.position=value;return this;}
    setText(value){this.label=value;return this;}
    setHTML(value){this.label=value;return this;}
    addTo(map){this.map=map;return this;}
    remove(){return this;}
  }
  const make=new Function('Map','Marker','Popup','NavigationControl','LngLatBounds','setWorkerUrl','spaceCoordinates','fetch',
    engine+'\nreturn createTraceMap');
  const createTraceMap=make(FakeMap,Noop,FakePopup,Noop,Bounds,()=>{},spaceCoordinates,fetchImpl);
  const instance=createTraceMap({},{anchors,onAnchorSelect,onLocationPick});
  const map=maps[0];
  if(load)map.callbacks.load();
  return {instance,map};
}
const anchors=[
  {uid:'A001',source_scope:'lo3rwang',trace_type:'space_anchor',title:'第一站',
    description:'歷史名稱：舊站名。',longitude:120.2,latitude:22.8},
  {uid:'B002',source_scope:'lo3rwang',trace_type:'space_anchor',title:'第二站',
    longitude:121.5,latitude:25.1},
  {uid:'C003',source_scope:'lo3rwang',trace_type:'space_anchor',title:'第三站',
    longitude:121.51,latitude:25.05}
];
test('saved route plots all numbered stops and preserves segment order',()=>{
  const {instance,map}=setup({anchors});
  instance.setSavedRoute({uid:'R001',source_scope:'lo3rwang',trace_type:'path',anchor_list:anchors.map(a=>a.uid)});
  const features=map.sources['loc-trace-user-routes'].data.features;
  assert.deepEqual(features.filter(f=>f.geometry.type==='Point')
    .map(f=>f.properties.order),[1,2,3]);
  assert.equal(features.filter(f=>f.geometry.type==='LineString').length,2);
  assert.ok(map.bounds.some(call=>call.points.length===3));
  instance.destroy();
});
test('clearing route removes line and no saved anchors never shows sample markers',()=>{
  const {instance,map}=setup({anchors});
  instance.setSavedRoute({uid:'R001',source_scope:'lo3rwang',trace_type:'path',anchor_list:anchors.map(a=>a.uid)});
  instance.setSavedRoute(null);
  assert.deepEqual(map.sources['loc-trace-user-routes'].data.features,[]);
  assert.equal(map.sources['loc-trace-extrusions'],undefined);
  instance.setAnchors([]);
  assert.deepEqual(map.sources['loc-trace-saved-anchors'].data.features,[]);
  instance.destroy();
});
test('pin clicks preserve full original record including historical place names',()=>{
  let selected=null;
  const {instance,map}=setup({anchors,onAnchorSelect:anchor=>{selected=anchor;}});
  map.callbacks['click|loc-trace-saved-point-layer']({
    features:[{properties:{uid:anchors[0].uid,source_scope:'lo3rwang'}}]});
  assert.equal(selected?.description,'歷史名稱：舊站名。');
  instance.destroy();
});

test('Banqiao Station is the origin; reloading anchors never resets the viewport',()=>{
  const {instance,map}=setup({anchors:[]});
  assert.deepEqual(map.options.center,[121.4638,25.0143]);
  assert.equal(map.fly.length,0);
  instance.setAnchors(anchors);
  assert.equal(map.fly.length,0);
  assert.equal(map.bounds.length,0);
  instance.goOrigin();
  assert.deepEqual(map.fly.at(-1).center,[121.4638,25.0143]);
  instance.destroy();
});

test('clicking a far saved pin recenters only once; its original data reaches the report',()=>{
  let selected=null;
  const {instance,map}=setup({anchors,onAnchorSelect:anchor=>{selected=anchor;}});
  const event={features:[{properties:{uid:anchors[0].uid,source_scope:'lo3rwang'}}]};
  map.callbacks['click|loc-trace-saved-point-layer'](event);
  assert.equal(map.ease.length,1);
  assert.deepEqual(map.ease[0].center,[anchors[0].longitude,anchors[0].latitude]);
  assert.equal(selected.description,'歷史名稱：舊站名。');
  map.callbacks['click|loc-trace-saved-point-layer'](event);
  assert.equal(map.ease.length,1,'already centered — do not interrupt user zoom');
  instance.destroy();
});

test('numbered route stops are also clickable even when they overlap source pin',()=>{
  let selected=null;
  const {instance,map}=setup({anchors,onAnchorSelect:anchor=>{selected=anchor;}});
  const route={uid:'R001',source_scope:'lo3rwang',trace_type:'path',
    anchor_list:anchors.map(row=>row.uid)};
  instance.setSavedRoute(route);
  map.callbacks['click|loc-trace-user-route-stops']({
    features:[{properties:{uid:anchors[1].uid,source_scope:'lo3rwang'}}]});
  assert.equal(selected.uid,anchors[1].uid);
  assert.equal(map.sources['loc-trace-user-routes'].data.features
    .filter(row=>row.geometry.type==='Point').length,3);
  instance.destroy();
});

test('trace-only union keeps its saved lines on initial map load and frames all endpoints',()=>{
  const {instance,map}=setup({anchors,load:false});
  const union={uid:'LOC_UNION',source_scope:'lo3rwang',trace_type:'trace',
    anchor_list:[],route_list:{routes:['R001'],segments:[]}};
  const graph={type:'FeatureCollection',features:[{
    type:'Feature',properties:{kind:'saved-trace-segment'},
    geometry:{type:'LineString',coordinates:[[120.2,22.8],[121.5,25.1]]}
  }]};
  instance.setSavedRoute(union);
  instance.setSavedGraph(graph);
  map.callbacks.load();
  assert.equal(map.sources['loc-trace-user-routes'].data.features.length,1,
    'rendered route union must not be cleared during initial loading');
  assert.deepEqual(map.bounds.at(-1).points,[[120.2,22.8],[121.5,25.1]]);
  const before=map.bounds.length;
  instance.setSavedGraph(graph);
  assert.equal(map.bounds.length,before,'same render must not reset user viewport');
  instance.destroy();
});

test('rapid route clicks issue only one OSRM request until it settles',async()=>{
  let requests=0,finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const {instance,map}=setup({
    anchors, onLocationPick:()=>{},
    fetchImpl:async()=>{requests++;return pending;}
  });
  const first=instance.showRoadRoute();
  const duplicate=instance.showRoadRoute();
  assert.equal(await duplicate,false);
  assert.equal(requests,1,'concurrent route clicks must share one HTTP request');
  finish({ok:true,json:async()=>({routes:[{geometry:{
    coordinates:[[121.4638,25.0143],[121.4592,25.0085]]
  }}]})});
  assert.equal(await first,true);
  assert.equal(map.sources['loc-trace-route'].data.features.length,1);
  assert.equal(await instance.showRoadRoute(),false,'next click hides route');
  assert.equal(requests,1,'hiding a route must not fetch again');
  instance.destroy();
});

test('failed route fetch clears in-flight guard to permit explicit retry',async()=>{
  let requests=0;
  const {instance}=setup({
    anchors,onLocationPick:()=>{},
    fetchImpl:async()=>{
      requests++;
      if(requests===1)throw Error('OSRM unavailable');
      return {ok:true,json:async()=>({routes:[{geometry:{
        coordinates:[[121.4638,25.0143],[121.4592,25.0085]]
      }}]})};
    }
  });
  assert.equal(await instance.showRoadRoute(),false);
  assert.equal(await instance.showRoadRoute(),true);
  assert.equal(requests,2);
  instance.destroy();
});
