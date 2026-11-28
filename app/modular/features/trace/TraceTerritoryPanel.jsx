'use client';
import {useMemo,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {visualKeyColor,TERRITORY_STOPS,territoryLegendColor} from '../../visual-palette.mjs';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {mapBounded} from '../../../loc/query/bounded-parallel.mjs';
import {readCurrentTraceLucus,readPublishedTraceSourceScopes} from './trace-data';
import {territoryYearWindow,territoryRegions,territoryPointReadPlan,territoryWithLucus} from './trace-territory.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../../loc/preferences/default-year-window.mjs';

const TraceMap=dynamic(()=>import('./TraceMap'),{ssr:false});
const TracePlaceResults=dynamic(()=>import('./TracePlaceResults'),{ssr:false});
const currentYear=Number(DEFAULT_YEAR_WINDOW.startDate.slice(0,4));
const years=[0,1,2,3].map(offset=>currentYear-offset);
const dateFromStep=(year,step)=>{
  const start=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-start)/86400000;
  return new Date(start+Math.floor((days-1)*Number(step)/1000)*86400000).toISOString().slice(0,10);
};
const hasCoordinates=point=>point&&point.longitude!=null&&point.latitude!=null&&
  String(point.longitude).trim()!==''&&String(point.latitude).trim()!==''&&
  Number.isFinite(Number(point.longitude))&&Number.isFinite(Number(point.latitude))&&
  Math.abs(Number(point.longitude))<=180&&Math.abs(Number(point.latitude))<=90;

const EMPTY_ROUTE_MAPS=Object.freeze([]);
const EMPTY_ROUTE_POINTS=Object.freeze([]);

export default function TraceTerritoryPanel({scopeId='loc',onMapReady=null,routeOverlay=null}){
  const [year,setYear]=useState(currentYear);
  const [display,setDisplay]=useState('timeline');
  const [step,setStep]=useState(1000);
  const [selectedKey,setSelectedKey]=useState('');
  const [selectedVisitDay,setSelectedVisitDay]=useState('');
  const [search,setSearch]=useState('');
  const [registerOpen,setRegisterOpen]=useState(false);
  const reduceMotion=useReducedMotion();
  const rootRef=useRef(null);
  const period=territoryYearWindow(year);
  const scopeQuery=useAsyncResource({
    queryKey:['trace-territory-published-scopes-v1',scopeId],
    enabled:scopeId==='loc',
    queryFn:readPublishedTraceSourceScopes,
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const scopes=useMemo(()=>scopeId==='loc'?scopeQuery.data||[]:[scopeId],
    [scopeId,scopeQuery.data]);
  // One year-bounded GROUP BY per published Scope. Neither source switching nor
  // advancing the month slider triggers another query.
  const [territoryCheckpoint,setTerritoryCheckpoint]=useState(null);
  const territoryKey=JSON.stringify([scopeId,year,scopes]);
  const totalsQuery=useAsyncResource({
    queryKey:['trace-territory-v1',year,...scopes],
    enabled:scopes.length>0&&(scopeId!=='loc'||scopeQuery.data!==undefined),
    queryFn:async({signal})=>{
      setTerritoryCheckpoint(null);
      return (await mapBounded(scopes,async scope=>{
        const {queryTrace}=await import('../../../loc/actions/trace/queries.mjs');
        const {data}=await queryTrace({
          p_scope_id:scope,p_view:'trace_territory',
          p_start:period.startDate,p_end:period.endDate,p_options:{withPoints:true}
        });
        if(!Array.isArray(data))throw Error('年度來源彙整資料格式錯誤');
        return data.map(row=>({...row,source_scope:scope}));
      },{signal,onCheckpoint:(batches,progress)=>{
        if(!signal.aborted)setTerritoryCheckpoint({key:territoryKey,rows:batches.flat(),...progress});
      }})).flat();
    },
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const mid=totalsQuery.isPending&&!totalsQuery.error&&territoryCheckpoint?.key===territoryKey?territoryCheckpoint:null;
  const territoryRows=totalsQuery.data||mid?.rows||[];
  const regions=useMemo(()=>territoryRegions(territoryRows,year),[territoryRows,year]);
  const pointPlan=useMemo(()=>territoryPointReadPlan(territoryRows,regions),[territoryRows,regions]);
  const pointGroups=pointPlan.groups;
  const pointsQuery=useAsyncResource({
    queryKey:['trace-territory-coordinates-v1',year,scopeId,
      ...pointGroups.map(group=>group.scope+':'+group.ids.join(','))],
    enabled:totalsQuery.data!==undefined&&pointGroups.length>0,
    queryFn:async()=>(await mapBounded(pointGroups,group=>
      readCurrentTraceLucus(group.scope,group.ids))).flat(),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const countries=useMemo(()=>territoryWithLucus(regions,[
    ...pointPlan.points,...(pointsQuery.data||[])
  ]),[regions,pointPlan,pointsQuery.data]);
  const cutoff=display==='timeline'?dateFromStep(year,step):period.endDate;
  const active=useMemo(()=>countries.filter(place=>place.firstDay<=cutoff),[countries,cutoff]);
  const activeByKey=useMemo(()=>new Map(active.map(place=>[place.source_scope+':'+place.uid,place])),[active]);
  const mapped=useMemo(()=>active.filter(place=>hasCoordinates(place.point)),[active]);
  const routeMaps=Array.isArray(routeOverlay?.maps)?routeOverlay.maps:EMPTY_ROUTE_MAPS;
  const routePoints=Array.isArray(routeOverlay?.points)?routeOverlay.points:EMPTY_ROUTE_POINTS;
  const routeLucus=useMemo(()=>{
    const byKey=new Map();
    for(const point of routePoints){
      const key=String(point?.source_scope||'')+':'+String(point?.uid||'');
      if(point?.uid)byKey.set(key,point);
    }
    for(const place of mapped){
      const point={...place.point,territory_total:place.total,
        territory_source:place.sources[0]?.name||''};
      const key=String(point.source_scope||'')+':'+String(point.uid||'');
      byKey.set(key,{...byKey.get(key),...point});
    }
    return [...byKey.values()];
  },[mapped,routePoints]);
  const mapData=useMemo(()=>({lucus:routeLucus,maps:routeMaps}),[routeLucus,routeMaps]);
  const selectedRouteUid=String(routeOverlay?.selectedRouteUid||'');
  const chosen=countries.find(place=>place.source_scope+':'+place.uid===selectedKey)||null;
  const selected=chosen&&activeByKey.has(selectedKey)?chosen:null;
  const keyOf=place=>place.source_scope+':'+place.uid;
  const selectPlace=place=>{
    setSelectedKey(keyOf(place));
    setSelectedVisitDay('');
  };
  const openFromRegister=place=>{
    selectPlace(place);
    rootRef.current?.querySelector('.loc-trace-map-shell')?.scrollIntoView({
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',
      block:'start'
    });
  };
  const ready=totalsQuery.data!==undefined;
  const totalArticles=regions.reduce((sum,place)=>sum+place.total,0);
  return <div ref={rootRef} className="loc-trace-territory" aria-label="年度文章地點戰略版圖">
    <TraceMap key="territory" publicTrace territoryMode territoryYear={year} onReady={onMapReady}
      spatialData={mapData} selectedRouteUid={selectedRouteUid} showLucusSearch={false}
      onLucusSelect={selectPlace}
      floatingControls={<div className="loc-trace-territory-toolbar">
        <label>年度
          <select className="scope-select" value={year} onChange={event=>{
            setYear(Number(event.target.value));setStep(1000);setSelectedKey('');setSelectedVisitDay('');
          }}>{years.map(value=><option value={value} key={value}>{value} 年</option>)}</select>
        </label>
        <label>據點資訊
          <select className="scope-select" value={display} onChange={event=>setDisplay(event.target.value)}>
            <option value="timeline">到訪時間</option>
            <option value="sources">文章來源</option>
          </select>
        </label>
        <span className="scope-status">{period.startDate} ～ {period.endDate}</span>
        {routeOverlay?.controls||null}
        {display==='timeline'?<label className="loc-trace-territory-time">
          <span>文章日期推進至 {cutoff}</span>
          <input type="range" min="0" max="1000" step="1" value={step}
            aria-label="年度文章時間進度" onChange={event=>{setStep(Number(event.target.value));setSelectedKey('');}}/>
        </label>:null}
        {(totalsQuery.isPending||scopeId==='loc'&&scopeQuery.isPending||
          pointGroups.length>0&&pointsQuery.isPending)&&
          <span role="status" className="scope-status">{mid?`已完成 ${mid.completed}／${mid.total} 個 Scope，暫計 ${totalArticles.toLocaleString()} 篇；其餘仍在計算。`:totalsQuery.data!==undefined?'文章已統計，正在補入地點座標…':'整理年度據點中…'}</span>}
        {scopeQuery.error||totalsQuery.error||pointsQuery.error?
          <span role="alert" className="scope-status scope-error">年度據點資料暫時無法完整載入。</span>:null}
      </div>}/>
      {selected?<section className="loc-trace-place-report loc-trace-territory-dossier"
        aria-label={selected.title+'年度據點內政'}>
        <header className="loc-trace-float-heading">
          <div><span className="loc-trace-territory-eyebrow">據點內政 · {year}</span>
            <strong>{selected.title}</strong></div>
          <button type="button" className="loc-button" aria-label="關閉據點內政"
            onClick={()=>{setSelectedKey('');setSelectedVisitDay('');}}>×</button>
        </header>
        <div className="loc-trace-territory-stats">
          <span>年度文章 <strong>{selected.total}</strong></span>
          <span>來源 <strong>{selected.sources.length}</strong></span>
          <span>首筆 <strong>{selected.firstDay}</strong></span>
        </div>
        {display==='sources'?<div className="loc-trace-territory-lanes" aria-label="據點文章來源比例">
          {selected.sources.map(source=><div className="loc-trace-territory-lane" key={source.name}>
            <div><strong>{source.name}</strong><span>{source.count} 篇 · {source.percent.toFixed(1)}%</span></div>
            <div className="loc-trace-territory-track" role="img"
              aria-label={source.name+' 佔 '+source.percent.toFixed(1)+'%'} >
              <span style={{width:source.percent+'%',background:visualKeyColor(source.name)}}/>
            </div>
          </div>)}
        </div>:<>
          <div className="loc-trace-territory-visit-heading">
            <div><span className="loc-trace-territory-eyebrow">行程紀錄 · {year}</span>
              <strong>{selectedVisitDay||'選擇到訪日期'}</strong></div>
            {selectedVisitDay?<button type="button" className="loc-button"
              onClick={()=>setSelectedVisitDay('')}>返回日期列表</button>:null}
          </div>
          <ol className="loc-trace-territory-events" aria-label="文章日期序列">
            {selected.timeline.filter(row=>row.day<=cutoff).map(row=><motion.li layout={!reduceMotion} key={row.day}>
              <button type="button" className="loc-trace-territory-day"
                aria-pressed={selectedVisitDay===row.day}
                onClick={()=>setSelectedVisitDay(row.day)}>
                <time dateTime={row.day}>{row.day}</time><span>{row.count} 篇</span>
              </button>
            </motion.li>)}
          </ol>
          <AnimatePresence mode="wait" initial={false}>
            {selectedVisitDay?<motion.div key={selectedVisitDay}
              className="loc-trace-territory-day-detail"
              initial={reduceMotion?false:{opacity:0,y:7}}
              animate={{opacity:1,y:0}}
              exit={reduceMotion?{opacity:0}:{opacity:0,y:-4}}
              transition={reduceMotion?{duration:0}:{duration:.2,ease:'easeOut'}}>
              <TracePlaceResults
                key={keyOf(selected)+':'+year+':'+selectedVisitDay}
                place={selected.point||{uid:selected.uid,title:selected.title,
                  trace_type:'space_lucus',source_scope:selected.source_scope}}
                lucus={mapData.lucus} maps={[]}
                scopeId={selected.source_scope} tab="articles" allPlacedArticles
                dateRange={{startDate:selectedVisitDay,endDate:selectedVisitDay}}
                timeMode="none" defaultSort="desc"/>
            </motion.div>:null}
          </AnimatePresence>
        </>}
        <p className="scope-status">依文章日期排序，不代表實際抵達或行軍路線。</p>
      </section>:null}

      <section className="loc-trace-territory-overview" aria-label="年度版圖情報">
        <div aria-label="年度文章數色階參考" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'.35rem .65rem',fontSize:'.8rem'}}>
          <span className="scope-status">文章數色階</span>
          {TERRITORY_STOPS.map(([count],i)=><span key={count} style={{display:'inline-flex',alignItems:'center',gap:'.25rem'}}>
            <i aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',border:'1px solid var(--loc-text)',background:territoryLegendColor(i)}}/>
            {i===TERRITORY_STOPS.length-1?count+'+':count}
          </span>)}
          <span className="scope-status">篇</span>
        </div>
        <div className="loc-trace-territory-stats">
          <strong>年度版圖</strong>
          <span>{ready||mid?`${active.length} / ${regions.length} 座據點`:'— 座據點'}</span>
          <span>{ready||mid?`${mid?'暫計 ':''}${totalArticles.toLocaleString()} 篇年度文章`:'— 篇年度文章'}</span>
          <span>{ready||mid?`${mapped.length} 座已定錨`:'— 座已定錨'}</span>
        </div>
        {ready&&!regions.length?<p className="scope-status">這個年度沒有帶 place_id 的文章。</p>:null}
        {ready&&regions.length>mapped.length?<p className="scope-status">
          未具有效座標的據點仍保留在下方名冊，不虛構地理位置。
        </p>:null}
        <details className="loc-trace-territory-register" onToggle={event=>setRegisterOpen(event.currentTarget.open)}>
          <summary>年度據點名冊 · {active.length} 座</summary>
          {registerOpen?<><input type="search" className="scope-select" value={search} placeholder="尋找地點／來源"
            aria-label="搜尋年度據點" onChange={event=>setSearch(event.target.value)}/>
          <div className="loc-trace-territory-register-list">
            {active.filter(place=>(place.title+' '+place.uid+' '+place.sources.map(row=>row.name).join(' '))
              .toLowerCase().includes(search.trim().toLowerCase())).map(place=>
              <button key={keyOf(place)} type="button" className="loc-button"
                aria-pressed={selectedKey===keyOf(place)} onClick={()=>openFromRegister(place)}>
                <span>{place.title}</span>
                <small>{place.total} 篇{!hasCoordinates(place.point)?' · 待補座標':''}</small>
              </button>)}
          </div></>:null}
        </details>
      </section>
  </div>;
}
