import {spaceCoordinates} from './space-graph.mjs';
// First-party React Trace loads MapLibre from the project's pinned npm package.
// Public sample anchors are isolated from Galaxy. Deliberate place-search terms
// go only to the chosen geocoding service; map tiles do not receive article bodies
// or device geolocation. Route demonstrations use sample coordinates only.
import {Map,Marker,Popup,NavigationControl,LngLatBounds,setWorkerUrl} from 'maplibre-gl';

// MapLibre 6 ESM requires a same-origin worker under Next.js Turbopack.
// The official worker URL pattern also works with Next.js webpack builds.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url).toString());

const STYLE='https://tiles.openfreemap.org/styles/liberty';
export const TRACE_ORIGIN=Object.freeze({name:'板橋車站',lng:121.4638,lat:25.0143});

// Fixed, public example locations: these are NOT the user's Galaxy records.
// Geographic coordinates are approximate station-area anchors, not store doors.
export const EXAMPLE_ANCHORS=Object.freeze([
  {id:'banqiao',name:'板橋車站',lng:121.4638,lat:25.0143,height:125},
  {id:'fuzhong',name:'府中站',lng:121.4592,lat:25.0085,height:165},
  {id:'jiangzicui',name:'江子翠站',lng:121.4724,lat:25.0300,height:100}
]);

function ringAround({lng,lat},meters){
  // Great-circle bearings preserve meters across latitudes; a radius is an
  // approximate query footprint, not a precision claim about check-ins.
  const earthRadius=6371008.8;
  const distance=Math.min(Math.PI,meters/earthRadius);
  const lat0=lat*Math.PI/180;
  const lng0=lng*Math.PI/180;
  const ring=Array.from({length:48},(_,i)=>{
    const bearing=2*Math.PI*i/48;
    const targetLat=Math.asin(Math.sin(lat0)*Math.cos(distance)
      +Math.cos(lat0)*Math.sin(distance)*Math.cos(bearing));
    const targetLng=lng0+Math.atan2(
      Math.sin(bearing)*Math.sin(distance)*Math.cos(lat0),
      Math.cos(distance)-Math.sin(lat0)*Math.sin(targetLat));
    const degrees=targetLng*180/Math.PI;
    return [((degrees+540)%360)-180,targetLat*180/Math.PI];
  });
  ring.push(ring[0]);
  return ring;
}

function pillarGeojson(anchors){
  return {type:'FeatureCollection',features:anchors.map(place=>({
    type:'Feature',
    id:place.id,
    properties:{name:place.name,height:place.height},
    geometry:{type:'Polygon',coordinates:[ringAround(place,45)]}
  }))};
}
const DAY_MS=86400000;
function dayDiff(a,b){
  return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/DAY_MS);
}
// A rough, not-to-scale time stem: no axis labels or precise calendar ticks,
// just a proportional day-based stretch so denser/longer place histories read
// taller than sparse ones. Unit is whole days, per the author's own framing.
function placeDayStems(rows,allowedTitles){
  const byTitle=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const title=String(row?.category||'').trim();
    const day=String(row?.day||'').slice(0,10);
    const count=Math.max(0,Number(row?.item_count)||0);
    if(!title||!allowedTitles.has(title)||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!count)continue;
    if(!byTitle.has(title))byTitle.set(title,[]);
    byTitle.get(title).push({day,count});
  }
  for(const list of byTitle.values())list.sort((a,b)=>a.day.localeCompare(b.day));
  return byTitle;
}
function buildStemElement(days){
  const first=days[0].day,last=days[days.length-1].day;
  const span=Math.max(1,dayDiff(first,last));
  // Four fixed tiers, not a continuous curve: a day-ish history, a week-ish
  // one, a month-ish one, and a year-or-more one each get one set height,
  // so the step between tiers reads clearly instead of blending together.
  const height=span<=1?22:span<=7?44:span<=31?68:96;
  const wrap=document.createElement('div');
  wrap.className='loc-trace-day-stem';
  wrap.style.height=height+'px';
  const line=document.createElement('span');
  line.className='loc-trace-day-stem-line';
  wrap.appendChild(line);
  days.forEach(({day,count})=>{
    const ratio=span>0?dayDiff(first,day)/span:0;
    const tick=document.createElement('span');
    tick.className='loc-trace-day-stem-tick';
    tick.style.bottom=Math.round(ratio*(height-6))+'px';
    tick.title=day+'　'+count+' 篇';
    wrap.appendChild(tick);
  });
  return wrap;
}
function isValidSavedAnchor(anchor){
  if(anchor?.trace_type!=='space_anchor')return false;
  return Boolean(spaceCoordinates(anchor));
}
function existingAnchorPoints(anchors){
  return {type:'FeatureCollection',features:(Array.isArray(anchors)?anchors:[])
    .filter(isValidSavedAnchor)
    .map((a,i)=>({type:'Feature',id:i,properties:{title:String(a.title||''),address:String(a.postal_address||''),
        uid:String(a.uid||''),source_scope:String(a.source_scope||''),
        territoryTotal:Number(a.territory_total||0),territorySource:String(a.territory_source||'')},
      geometry:{type:'Point',coordinates:spaceCoordinates(a)}}))};
}
function emptyRoute(){
  return {type:'FeatureCollection',features:[]};
}
function routeGeometry(coordinates){
  return {type:'FeatureCollection',features:[{
    type:'Feature',properties:{kind:'planned'},
    geometry:{type:'LineString',coordinates}
  }]};
}

export function createTraceMap(container,{onStatus=()=>{},onSelect=()=>{},onLocationPick=null,onAnchorSelect=null,anchors=[],showAnchorPopup=true,onGaugeVisibilityChange=()=>{},territoryMode=false}={}){
  if(!container)throw new Error('找不到地圖容器。');
  const controller=new AbortController();
  let removed=false;
  let loaded=false;
  let routeActive=false;
  let routeLoading=false;
  let markers=[];
  let timelineMarkers=[];
  let timelineRows=[];
  let annualGaugeMarkers=[];
  let annualGaugeRows=[];
  let gaugeDetailVisible=false;
  let activeTimePointKeys=new Set();
  let pickedMarker=null;
  let pickedPosition=null;
  let savedAnchors=anchors;
  let stemsVisible=false;
  let selectedSavedRoute=null;
  let selectedSavedGraph=null;
  let lastGraphFocusKey='';
  function setAnchors(next){
    savedAnchors=Array.isArray(next)?next:[];
    if(!loaded)return;
    map.getSource('loc-trace-saved-anchors')?.setData(existingAnchorPoints(savedAnchors));
    refreshSavedRoute();
    refreshTimelineStems();
    refreshAnnualGauges();
    refreshTimeCursor();
    // Updating GeoJSON never resets the viewport. Only explicit navigation may.
  }
  // Day stems are gated by one explicit checkbox in the map's own corner
  // control, off by default: not a standing display for every anchor,
  // and not something a plain click half-shows and half-hides. Checked,
  // every currently valid/titled anchor on the map grows its stem at
  // once; unchecked, none do.
  function refreshTimelineStems(){
    timelineMarkers.forEach(marker=>marker.remove());
    timelineMarkers=[];
    if(!loaded||!timelineRows.length||!stemsVisible)return;
    const validAnchors=savedAnchors.filter(isValidSavedAnchor);
    const allowedTitles=new Set(validAnchors.map(a=>String(a.title||'').trim()).filter(Boolean));
    if(!allowedTitles.size)return;
    const byTitle=placeDayStems(timelineRows,allowedTitles);
    for(const anchor of validAnchors){
      const title=String(anchor.title||'').trim();
      const days=byTitle.get(title);
      if(!days?.length)continue;
      const element=buildStemElement(days);
      timelineMarkers.push(new Marker({element,anchor:'bottom',offset:[0,0]})
        .setLngLat(spaceCoordinates(anchor)).addTo(map));
    }
  }
  function refreshAnnualGauges(){
    annualGaugeMarkers.forEach(marker=>marker.remove());
    annualGaugeMarkers=[];
    if(!loaded||!annualGaugeRows.length||!gaugeDetailVisible)return;
    const byKey=new globalThis.Map(annualGaugeRows.map(row=>[
      String(row.source_scope||'')+':'+String(row.uid||''),row
    ]));
    // One small HUD per saved point, not per article. At zoomed-out scales,
    // the original MapLibre pin layer remains the lightweight overview.
    for(const point of savedAnchors.filter(isValidSavedAnchor).slice(0,80)){
      const row=byKey.get(String(point.source_scope||'')+':'+String(point.uid||''));
      if(!row||!Number.isFinite(Number(row.percent)))continue;
      const percent=Math.max(0,Math.min(100,Math.round(Number(row.percent))));
      const element=document.createElement('div');
      element.className='loc-trace-annual-gauge';
      element.style.setProperty('--loc-gauge-progress',Math.round(percent*2.7)+'deg');
      element.style.pointerEvents='none';
      element.setAttribute('aria-hidden','true');
      element.title='近一年文章存在 '+row.days+'/'+row.span+' 日（'+percent+'%）';
      const value=document.createElement('span');
      value.className='loc-trace-annual-gauge__number';
      value.textContent=percent+'%';
      element.appendChild(value);
      annualGaugeMarkers.push(new Marker({element,anchor:'center'})
        .setLngLat(spaceCoordinates(point)).addTo(map));
    }
  }
  function setAnnualGauges(rows){
    annualGaugeRows=Array.isArray(rows)?rows:[];
    refreshAnnualGauges();
  }
  function setPlaceTimelines(rows){
    timelineRows=Array.isArray(rows)?rows:[];
    refreshTimelineStems();
  }
  function setStemsVisible(visible){
    stemsVisible=Boolean(visible);
    refreshTimelineStems();
  }
  function refreshTimeCursor(){
    if(!loaded)return;
    // Only current map members are eligible; this is an in-memory GeoJSON
    // filter, not another database request or a guess at route travel order.
    const active=savedAnchors.filter(anchor=>activeTimePointKeys.has(
      String(anchor.source_scope||'')+':'+String(anchor.uid||'')));
    map.getSource('loc-trace-time-active')?.setData(existingAnchorPoints(active));
  }
  function setTimeCursor(keys=[]){
    activeTimePointKeys=new Set(Array.isArray(keys)?keys:[]);
    refreshTimeCursor();
  }
  function savedRoutePoints(route=selectedSavedRoute){
    if(!Array.isArray(route?.anchor_list))return [];
    const byId=new globalThis.Map(savedAnchors.filter(isValidSavedAnchor).map(row=>[String(row.uid),row]));
    const ids=route.trace_type==='trace'
      ?[...new Set(route.anchor_list.flat(Infinity))]:route.anchor_list;
    return ids.map(uid=>byId.get(String(uid))||null);
  }
  function savedRouteData(route=selectedSavedRoute){
    if(selectedSavedGraph)return selectedSavedGraph;
    // A trace is a collection of unrelated pairs; no temporary Queue bridges.
    if(route?.trace_type==='trace')return emptyRoute();
    const points=savedRoutePoints(route);
    const features=[];
    points.forEach((place,index)=>{
      if(!place)return;
      const coordinates=spaceCoordinates(place);
      features.push({type:'Feature',properties:{order:index+1,title:String(place.title||''),
        uid:String(place.uid||''),source_scope:String(place.source_scope||''),
        address:String(place.postal_address||'')},
        geometry:{type:'Point',coordinates}});
      const previous=points[index-1];
      if(previous)features.push({type:'Feature',properties:{kind:'saved-trace-segment'},
        geometry:{type:'LineString',coordinates:[
          spaceCoordinates(previous),coordinates
        ]}});
    });
    return {type:'FeatureCollection',features};
  }
  function refreshSavedRoute(){
    if(loaded)map.getSource('loc-trace-user-routes')?.setData(savedRouteData());
  }
  function setSavedRoute(route){
    const next=['path','trace'].includes(route?.trace_type)?route:null;
    const changed=(selectedSavedRoute?.source_scope||'')!==(next?.source_scope||'')
      ||(selectedSavedRoute?.uid||'')!==(next?.uid||'');
    selectedSavedRoute=next;
    selectedSavedGraph=null;
    if(changed)lastGraphFocusKey='';
    refreshSavedRoute();
    // Query refreshes may return a new object representing the same route.
    if(!loaded||!selectedSavedRoute||!changed)return;
    const valid=savedRoutePoints().filter(Boolean);
    if(valid.length===1){
      map.flyTo({center:spaceCoordinates(valid[0]),
        zoom:12.5,pitch:45,bearing:0,essential:true});
    }else if(valid.length>1){
      const bounds=new LngLatBounds();
      valid.forEach(point=>bounds.extend(spaceCoordinates(point)));
      map.fitBounds(bounds,{padding:Math.max(32,Math.min(90,Math.round(map.getContainer().clientWidth*.07))),
        pitch:0,bearing:0,maxZoom:13,duration:500});
    }
  }
  function setSavedGraph(graph){
    selectedSavedGraph=graph?.type==='FeatureCollection'&&Array.isArray(graph.features)
      ?graph:null;
    refreshSavedRoute();
    if(!loaded||!selectedSavedRoute||!selectedSavedGraph)return;
    const coordinates=[];
    for(const feature of selectedSavedGraph.features){
      const geometry=feature?.geometry;
      const candidates=geometry?.type==='Point'?[geometry.coordinates]
        :geometry?.type==='LineString'?geometry.coordinates:[];
      for(const point of candidates||[]){
        if(!Array.isArray(point)||point.length<2)continue;
        const [lng,lat]=point.map(Number);
        if(Number.isFinite(lng)&&Number.isFinite(lat)&&Math.abs(lng)<=180&&Math.abs(lat)<=90)
          coordinates.push([lng,lat]);
      }
    }
    if(!coordinates.length)return;
    const identity=(selectedSavedRoute.source_scope||'')+':'+selectedSavedRoute.uid;
    const focusKey=identity+':'+JSON.stringify(coordinates);
    if(lastGraphFocusKey===focusKey)return;
    lastGraphFocusKey=focusKey;
    if(coordinates.length===1){
      map.flyTo({center:coordinates[0],zoom:12.5,pitch:0,bearing:0,essential:true});
    }else{
      const bounds=new LngLatBounds();
      coordinates.forEach(point=>bounds.extend(point));
      map.fitBounds(bounds,{padding:Math.max(32,Math.min(90,Math.round(map.getContainer().clientWidth*.07))),
        pitch:0,bearing:0,maxZoom:13,duration:500});
    }
  }
  const canPickLocation=typeof onLocationPick==='function';
  // The user's "home" is a public station-area navigation origin, not a
  // saved visit or residential address. A map click never resets to this.
  function goOrigin(){
    if(removed)return;
    map.flyTo({center:[TRACE_ORIGIN.lng,TRACE_ORIGIN.lat],
      zoom:13,pitch:45,bearing:0,essential:true});
  }
  function centerIfFar(longitude,latitude){
    const lng=Number(longitude),lat=Number(latitude);
    if(removed||!Number.isFinite(lng)||!Number.isFinite(lat))return false;
    const canvas=map.getCanvas(),width=canvas?.clientWidth||map.getContainer().clientWidth||0;
    const height=canvas?.clientHeight||map.getContainer().clientHeight||0;
    const projected=typeof map.project==='function'?map.project([lng,lat]):null;
    // An already central point does not interrupt the user's zoom/tilt.
    const far=projected&&width>0&&height>0
      ?Math.abs(projected.x-width/2)>width*.26||Math.abs(projected.y-height/2)>height*.26
      :true;
    if(far)map.easeTo({center:[lng,lat],duration:350,essential:true});
    return far;
  }
  // On touch devices one-finger swipes should scroll the *page*, not
  // accidentally trap the user inside this tall map. Two fingers can still
  // pan, rotate and pinch-zoom it; desktop mouse dragging stays unchanged.
  const touchDevice=typeof window!=='undefined'
    &&Boolean(window.matchMedia?.('(pointer:coarse)').matches);
  const map=new Map({
    container,style:STYLE,center:[TRACE_ORIGIN.lng,TRACE_ORIGIN.lat],
    zoom:canPickLocation?12.8:13,pitch:canPickLocation?59:45,bearing:canPickLocation?-23:0,
    cooperativeGestures:touchDevice,
    antialias:true,attributionControl:true
  });
  map.addControl(new NavigationControl({showCompass:true,showZoom:true}),'top-right');
  const status=message=>{if(!removed)onStatus(message);};
  // Spatial anchors are explicit user selections, never inferred from device
  // location or demo coordinates. Only the management editor enables picking.
  function pickLocation(lng,lat,name=''){
    if(removed||!canPickLocation||!Number.isFinite(lng)||!Number.isFinite(lat))return;
    if(!pickedMarker){
      pickedMarker=new Marker({color:'#f7ba66',draggable:true})
        .setLngLat([lng,lat]).addTo(map);
      pickedMarker.on('dragend',()=>{
        const position=pickedMarker.getLngLat();
        pickLocation(position.lng,position.lat);
      });
    }else pickedMarker.setLngLat([lng,lat]);
    pickedPosition={lng,lat};
    onLocationPick({lng,lat,...(name?{name}:{})});
    status('locationPicked');
  }
  if(canPickLocation){
    map.on('click',event=>pickLocation(event.lngLat.lng,event.lngLat.lat));
  }
  function focus(id){
    if(removed)return;
    const place=EXAMPLE_ANCHORS.find(item=>item.id===id);
    if(!place)return;
    map.flyTo({center:[place.lng,place.lat],zoom:15.1,pitch:65,bearing:-23,essential:true});
    onSelect(place.id);
    if(canPickLocation)pickLocation(place.lng,place.lat,place.name);
    new Popup({closeButton:true,offset:24})
      .setLngLat([place.lng,place.lat])
      .setText(place.name)
      .addTo(map);
  }
  function focusCoordinates({longitude,latitude,name=''}={}){
    const lng=Number(longitude),lat=Number(latitude);
    if(removed||!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lng)>180||Math.abs(lat)>90)return;
    const zoom=14.5;
    if(canPickLocation)map.flyTo({center:[lng,lat],zoom,pitch:59,bearing:-23,essential:true});
    else centerIfFar(lng,lat);
    if(canPickLocation)pickLocation(lng,lat,name);
    else {pickedPosition={lng,lat};}
    if(!canPickLocation&&showAnchorPopup)new Popup({closeButton:true,offset:20}).setLngLat([lng,lat]).setText(name||'搜尋位置').addTo(map);
  }
  function overview(){
    if(removed||!loaded)return;
    // "All anchors" means the saved markers currently displayed by Trace,
    // not the three Banqiao demonstration stations.
    const visibleAnchors=(Array.isArray(savedAnchors)?savedAnchors:[])
      .filter(isValidSavedAnchor)
      .map(anchor=>({lng:Number(anchor.longitude),lat:Number(anchor.latitude)}));
    if(visibleAnchors.length===1){
      map.flyTo({center:[visibleAnchors[0].lng,visibleAnchors[0].lat],zoom:12.5,
        pitch:45,bearing:0,essential:true});
      return;
    }
    if(!visibleAnchors.length){
      if(!canPickLocation){
        map.flyTo({center:[120.98,23.73],zoom:6.5,pitch:0,bearing:0,essential:true});
        return;
      }
    }
    const points=visibleAnchors.length?visibleAnchors:EXAMPLE_ANCHORS;
    const bounds=new LngLatBounds();
    points.forEach(place=>bounds.extend([place.lng,place.lat]));
    // Map padding scales with its actual dimensions, including after resizing.
    map.fitBounds(bounds,{padding:Math.max(30,Math.min(80,Math.round(map.getContainer().clientWidth*.045))),
      pitch:visibleAnchors.length?45:59,bearing:visibleAnchors.length?0:-23,
      maxZoom:visibleAnchors.length?14:13.7,duration:500});
  }

  map.once('load',()=>{
    if(removed)return;
    loaded=true;
    gaugeDetailVisible=map.getZoom()>=10.5;
    onGaugeVisibilityChange(gaugeDetailVisible);
    refreshTimelineStems();
    refreshAnnualGauges();
    if(canPickLocation){
      // The Banqiao mock stations belong to the anchor editor only.
      map.addSource('loc-trace-extrusions',{type:'geojson',data:pillarGeojson(EXAMPLE_ANCHORS)});
      map.addLayer({
        id:'loc-trace-3d-anchors',type:'fill-extrusion',source:'loc-trace-extrusions',
        paint:{'fill-extrusion-color':'#b9a6f6','fill-extrusion-opacity':0.8,
          'fill-extrusion-height':['get','height'],'fill-extrusion-base':0}
      });
    }
    map.addSource('loc-trace-saved-anchors',{type:'geojson',data:existingAnchorPoints(savedAnchors)});
    if(territoryMode)map.addLayer({id:'loc-trace-territory-halo',type:'circle',
      source:'loc-trace-saved-anchors',paint:{
        'circle-radius':['step',['get','territoryTotal'],19,3,23,10,29,30,35,100,43],
        'circle-color':'#ffc979','circle-opacity':0.13,
        'circle-stroke-width':1,'circle-stroke-color':'#ffc979','circle-stroke-opacity':0.55
      }});
    map.addLayer({id:'loc-trace-saved-point-layer',type:'circle',source:'loc-trace-saved-anchors',
      paint:territoryMode?{
        'circle-radius':['step',['get','territoryTotal'],7,3,10,10,14,30,18,100,23],
        'circle-color':'#f8b963','circle-opacity':0.91,
        'circle-stroke-width':2,'circle-stroke-color':'#fff4cd'
      }:{'circle-radius':6,'circle-color':'#6ce4ce','circle-opacity':0.95,
        'circle-stroke-width':1.5,'circle-stroke-color':'#153739'}});
    map.addLayer({id:'loc-trace-saved-point-labels',type:'symbol',source:'loc-trace-saved-anchors',
      minzoom:12,layout:{'text-field':['get','title'],
        'text-size':12,'text-offset':[0,1.2],'text-anchor':'top',
        'text-allow-overlap':false},paint:{'text-color':'#ebfff8','text-halo-color':'#122d39','text-halo-width':1.5}});
    if(typeof onAnchorSelect==='function'){
      const chooseAnchor=event=>{
        const props=event.features?.[0]?.properties;
        if(!props?.uid)return;
        // Pass the complete saved row: its original description contains
        // reviewed aliases required by the inline article list. GeoJSON
        // presentation properties alone omit that contextual information.
        const anchor=savedAnchors.find(row=>String(row.uid)===String(props.uid)
          &&String(row.source_scope||'')===String(props.source_scope||''));
        if(anchor){
          if(showAnchorPopup)centerIfFar(...spaceCoordinates(anchor));
          onAnchorSelect(anchor);
          if(showAnchorPopup)new Popup({closeButton:true,offset:18})
            .setLngLat(spaceCoordinates(anchor))
            .setText([anchor.title,anchor.postal_address].filter(Boolean).join(' · '))
            .addTo(map);
        }
      };
      for(const layer of ['loc-trace-saved-point-layer','loc-trace-saved-point-labels']){
        map.on('click',layer,chooseAnchor);
        map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
      }
    }
    // Saved routes connect user-selected anchors in their recorded sequence.
    // A straight connection is not presented as an actual historical road.
    map.addSource('loc-trace-user-routes',{type:'geojson',data:savedRouteData()});
    map.addLayer({id:'loc-trace-user-route-lines',type:'line',source:'loc-trace-user-routes',
      filter:['==',['geometry-type'],'LineString'],
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#ffcb73','line-width':4,'line-opacity':0.95}});
    map.addLayer({id:'loc-trace-user-route-stops',type:'circle',source:'loc-trace-user-routes',
      filter:['==',['geometry-type'],'Point'],
      paint:{'circle-radius':12,'circle-color':'#ffcb73','circle-stroke-color':'#30253e',
        'circle-stroke-width':2}});
    map.addLayer({id:'loc-trace-user-route-order',type:'symbol',source:'loc-trace-user-routes',
      filter:['all',['==',['geometry-type'],'Point'],['==',['get','kind'],'space_stop']],
      layout:{'text-field':['to-string',['get','order']],'text-size':12,
        'text-allow-overlap':true},
      paint:{'text-color':'#30253e'}});
    // The proportional timeline highlights only Point UIDs with a recorded
    // visit at or before the cursor. The saved routes remain spatial geometry.
    map.addSource('loc-trace-time-active',{type:'geojson',data:emptyRoute()});
    map.addLayer({id:'loc-trace-time-active-points',type:'circle',source:'loc-trace-time-active',
      paint:{'circle-radius':15,'circle-color':'#ffffff','circle-opacity':0.08,
        'circle-stroke-width':3,'circle-stroke-color':'#6ce4ce','circle-stroke-opacity':0.95}});
    refreshTimeCursor();
    map.on('zoomend',()=>{
      const next=map.getZoom()>=10.5;
      if(next===gaugeDetailVisible)return;
      gaugeDetailVisible=next;
      onGaugeVisibilityChange(next);
      refreshAnnualGauges();
    });
    // Saved route markers render over the source anchor dots; make either
    // visible geometry selectable and keep the full original anchor data.
    if(typeof onAnchorSelect==='function'){
      const clickSavedStop=event=>{
        const props=event.features?.[0]?.properties;
        const anchor=savedAnchors.find(row=>String(row.uid)===String(props?.uid||'')
          &&String(row.source_scope||'')===String(props?.source_scope||''));
        if(!anchor)return;
        if(showAnchorPopup)centerIfFar(...spaceCoordinates(anchor));
        onAnchorSelect(anchor);
      };
      for(const layer of ['loc-trace-user-route-stops','loc-trace-user-route-order']){
        map.on('click',layer,clickSavedStop);
        map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
      }
    }
    map.addSource('loc-trace-route',{type:'geojson',data:emptyRoute()});
    map.addLayer({
      id:'loc-trace-route-line',type:'line',source:'loc-trace-route',
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':'#f7ba66','line-width':5,'line-opacity':0.95}
    });
    if(canPickLocation)markers=EXAMPLE_ANCHORS.map(place=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='loc-trace-anchor-marker';
      button.textContent=place.name;
      button.setAttribute('aria-label','查看'+place.name+'空間定錨示例');
      button.addEventListener('click',()=>focus(place.id));
      return new Marker({element:button,anchor:'bottom',offset:[0,-13]})
        .setLngLat([place.lng,place.lat]).addTo(map);
    });
    // No implicit fit/overview on load: the origin remains stable until
    // the current route is explicitly chosen by the parent.
    if(selectedSavedRoute){
      const openingRoute=selectedSavedRoute;
      const openingGraph=selectedSavedGraph;
      selectedSavedRoute=null;
      setSavedRoute(openingRoute);
      setSavedGraph(openingGraph);
    }
    status('ready');
  });
  map.on('error',event=>{
    if(!loaded)status('mapError');
  });

  async function showRoadRoute(){
    if(removed||!loaded||!canPickLocation||routeLoading)return false;
    if(routeActive){
      map.getSource('loc-trace-route')?.setData(emptyRoute());
      routeActive=false;
      status('routeHidden');
      return false;
    }
    routeLoading=true;
    status('routeLoading');
    try{
      // The public OSRM demo is used only after an explicit route click. It
      // receives the three public example coordinates, never user locations.
      const coords=EXAMPLE_ANCHORS.map(p=>p.lng+','+p.lat).join(';');
      const response=await fetch('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson',{
        signal:controller.signal
      });
      if(!response.ok)throw new Error('路網服務暫時無法使用');
      const payload=await response.json();
      const coordinates=payload.routes?.[0]?.geometry?.coordinates;
      if(!Array.isArray(coordinates)||coordinates.length<2)throw new Error('沒有可用的道路路線');
      if(removed)return false;
      map.getSource('loc-trace-route')?.setData(routeGeometry(coordinates));
      routeActive=true;
      status('routeReady');
      return true;
    }catch(error){
      if(!removed&&error?.name!=='AbortError')status('routeError');
      return false;
    }finally{
      routeLoading=false;
    }
  }
  function destroy(){
    if(removed)return;
    removed=true;
    controller.abort();
    markers.forEach(marker=>marker.remove());
    markers=[];
    timelineMarkers.forEach(marker=>marker.remove());
    timelineMarkers=[];
    annualGaugeMarkers.forEach(marker=>marker.remove());
    annualGaugeMarkers=[];
    pickedMarker?.remove();
    pickedMarker=null;
    map.remove();
  }
  return {focus,focusCoordinates,centerIfFar,goOrigin,setAnchors,setPlaceTimelines,setAnnualGauges,setStemsVisible,setTimeCursor,setSavedRoute,setSavedGraph,overview,showRoadRoute,
    resize:()=>{if(!removed)map.resize();},destroy};
}
