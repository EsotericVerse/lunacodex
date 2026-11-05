// LOC displays a read-only union of published, saved route relationships.
// Never infer visits, join unrelated routes, or expose hidden source records.
export function publicTraceMapChoices(rows=[],scopeId='loc'){
  const saved=(Array.isArray(rows)?rows:[]).filter(row=>
    (row?.trace_type==='path'||row?.trace_type==='trace')&&
    (scopeId==='loc'||row?.source_scope===scopeId));
  if(scopeId!=='loc')return saved;
  // Surface individual saved routes first: the homepage renders only one
  // selected path, never the union of every Scope's points on startup.
  const individual=saved.filter(row=>row.trace_type==='path');
  const unions=[...new Set(saved.map(row=>row.source_scope).filter(Boolean))].flatMap(source=>{
    const own=saved.filter(row=>row.source_scope===source);
    const routes=own.filter(row=>row.trace_type==='path');
    const routeById=new Map(routes.map(row=>[row.uid,row]));
    const routeIds=new Set(routes.map(row=>row.uid));
    const seenPairs=new Set(),pairs=[];
    for(const trace of own.filter(row=>row.trace_type==='trace')){
      for(const uid of trace.route_list?.routes||[])if(routeById.has(uid))routeIds.add(uid);
      for(const pair of trace.route_list?.segments||[]){
        if(!Array.isArray(pair)||pair.length!==2||pair[0]===pair[1]||
          pair.some(uid=>!/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(uid))))continue;
        const key=pair.join(':');
        if(!seenPairs.has(key)){seenPairs.add(key);pairs.push(pair);}
      }
    }
    if(!routeIds.size&&!pairs.length)return [];
    return [{uid:'LOC_UNION',trace_type:'trace',source_scope:source,
      title:'痕跡圖聯集',description:'',anchor_list:[...new Set(pairs.flat())],route_list:{routes:[...routeIds],segments:pairs},
      read_only:true}];
  });
  // The legacy LOC union remains available only as an explicit selection.
  return [...individual,...unions];
}

/**
 * LOC public pin preview: at most 50 distinct point UIDs per contributing
 * Scope, referenced by its saved paths or traces. Never enumerate point rows.
 */
export function locReferencedPointGroups(rows=[],maxPerScope=50){
  const eligible=(Array.isArray(rows)?rows:[]).filter(row=>
    ['path','trace'].includes(row?.trace_type)&&row.source_scope);
  const byScope=new Map();
  for(const row of eligible){
    if(!byScope.has(row.source_scope))byScope.set(row.source_scope,[]);
    byScope.get(row.source_scope).push(row);
  }
  const uid=value=>String(value||'').trim();
  const isUid=value=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(value);
  return [...byScope].map(([scope,records])=>{
    const paths=new Map(records.filter(row=>row.trace_type==='path')
      .map(row=>[uid(row.uid),row]));
    const seen=new Set();
    const ids=[];
    const add=value=>{
      const key=uid(value);
      if(isUid(key)&&!seen.has(key)&&ids.length<maxPerScope){
        seen.add(key);ids.push(key);
      }
    };
    // Route and trace references are the only source of candidates.
    // Do not invent references from standalone point rows.
    for(const record of records){
      const refs=record.anchor_list||[];
      for(const value of refs.flat(Infinity))add(value);
      if(record.trace_type==='trace'){
        for(const pair of record.route_list?.segments||[]){
          for(const value of (Array.isArray(pair)?pair:[]))add(value);
        }
        for(const pathId of record.route_list?.routes||[]){
          const path=paths.get(uid(pathId));
          for(const value of (path?.anchor_list||[]).flat(Infinity))add(value);
        }
      }
    }
    return {scope,ids};
  }).filter(group=>group.ids.length);
}

/**
 * Dynamically combine almost-coincident public point pins. Inputs are already
 * limited to path/trace references. The final LOC map has at most 50 pins.
 * A 75-metre radius allows small GPS/check-in differences without conflating
 * separate neighborhoods. Original point records are never changed.
 */
export function clusterLocSharedPoints(points=[],maxPins=50,radiusMeters=75){
  const sources=new Map();
  for(const point of Array.isArray(points)?points:[]){
    const scope=String(point?.source_scope||'');
    if(!scope)continue;
    if(!sources.has(scope))sources.set(scope,[]);
    sources.get(scope).push(point);
  }
  // Build a bounded union (<= 50 * contributing scopes) before the *final*
  // 50-pin cap. Truncating after each member would hide later shared locations.
  const clusters=[];
  const radians=Math.PI/180;
  const distance=(a,b)=>{
    const latA=Number(a.latitude)*radians,latB=Number(b.latitude)*radians;
    const dLat=latB-latA,dLon=(Number(b.longitude)-Number(a.longitude))*radians;
    const h=Math.sin(dLat/2)**2+Math.cos(latA)*Math.cos(latB)*Math.sin(dLon/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
  };
  for(const queue of sources.values()){
    for(const point of queue){
      const lat=Number(point.latitude),lng=Number(point.longitude);
      if(point.latitude==null||point.longitude==null||
        !Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;
      const match=clusters.find(cluster=>distance(cluster,point)<=radiusMeters);
      if(match){
        if(!match.members.some(member=>member.source_scope===point.source_scope&&member.uid===point.uid))
          match.members.push(point);
      }else{
        clusters.push({...point,latitude:lat,longitude:lng,members:[point]});
      }
    }
  }
  // Shared positions (more distinct contributing members) appear first.
  // Stable input order breaks ties; original UID and coordinate data stay intact.
  const ranked=clusters.map((cluster,index)=>({
    cluster,index,shareCount:new Set(cluster.members.map(member=>member.source_scope)).size
  })).sort((a,b)=>b.shareCount-a.shareCount||a.index-b.index)
    .slice(0,Math.max(0,Math.floor(maxPins)));
  return ranked.map(({cluster,shareCount})=>{
    const lines=cluster.members.map(member=>
      String(member.source_scope)+':'+String(member.title||member.uid||'定錨點'));
    return {...cluster,title:lines.join(' / '),display_names:lines,member_count:cluster.members.length,share_count:shareCount};
  });
}
