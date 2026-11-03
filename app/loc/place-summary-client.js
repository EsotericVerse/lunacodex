'use client';

import {Capacitor} from '@capacitor/core';

// Web: use the unified DB-side analytics entry, not a full article scan.
// Native/local SQLite retains the original on-device row-level reader.
export async function readPlaceSummary(scopeId,{startDate='',endDate=''}={}){
  const [{forEachAllRowsPage,selectRows},{defaultScopeData},{dbPublicClient}]=await Promise.all([
    import('./db-query.mjs'),import('./scope-data'),import('./db-client.mjs')
  ]);
  const scope=defaultScopeData(scopeId);
  if(!scope)return {rows:[],anchors:[]};
  if(scopeId!=='local'&&!Capacitor.isNativePlatform()){
    const {data,error}=await dbPublicClient.schema('silver').analytics({
      p_scope_id:scopeId,p_view:'trace_places',
      p_start:startDate||null,p_end:endDate||null,p_options:{}
    });
    if(error)throw error;
    if(!Array.isArray(data))throw new Error('Invalid place summary RPC result');
    let anchors=[];
    if(['lo3rwang','lrunes'].includes(scopeId)){
      // The Trace adapter maps space_anchor to native Anchor.type='point'
      // for lo3rwang; 'anchor' means a Time/date node, not a place.
      const pageSize=500;
      for(let offset=0;;offset+=pageSize){
        const {rows}=await selectRows('silver.'+scopeId+'_trace',{
          columns:'uid,title',filters:[{column:'trace_type',operator:'eq',value:'space_anchor'}],
          orders:[{column:'title',ascending:true},{column:'uid',ascending:true}],
          limit:pageSize,offset
        });
        anchors.push(...rows.map(row=>({uid:row.uid,title:row.title})));
        if(rows.length<pageSize)break;
      }
    }
    return {rows:data,anchors};
  }
  const filters=[
    {column:'trace',operator:'eq',value:'true'},
    {column:'content',operator:'neq',value:''},
    ...(startDate?[{column:'createtime',operator:'gte',value:startDate+'T00:00:00+08:00'}]:[]),
    ...(endDate?[{column:'createtime',operator:'lte',value:endDate+'T23:59:59.999+08:00'}]:[])
  ];
  // Stream page by page and keep only the per-day counters; no uid or row list.
  const summary=new Map();
  await forEachAllRowsPage(scope.galaxy,{columns:'location,createtime',filters},rows=>{
    for(const row of rows){
      const place=String(row.location||'').trim();
      if(!place||!row.createtime)continue;
      const day=new Intl.DateTimeFormat('sv-SE',{
        timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
      }).format(new Date(row.createtime));
      const key=day+'\u0000'+place;
      summary.set(key,(summary.get(key)||0)+1);
    }
  });
  return {
    rows:[...summary].map(([key,item_count])=>{
      const [day,category]=key.split('\u0000');
      return {day,category,item_count};
    }),
    anchors:[]
  };
}
