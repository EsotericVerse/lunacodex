'use client';
import {useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from '../../../loc/use-async-resource';
import {dbPublicClient} from '../../../loc/db-client.mjs';
import {mapBounded} from '../../../loc/bounded-parallel.mjs';
import {readCurrentTraceAnchors,readPublishedTraceSourceScopes} from './trace-data';
import {territoryYearWindow,territoryRegions,territoryPointGroups,territoryWithAnchors} from './trace-territory.mjs';

const TraceMap=dynamic(()=>import('./TraceMap'),{ssr:false});
const TracePlaceResults=dynamic(()=>import('./TracePlaceResults'),{ssr:false});
const years=[2026,2025,2024,2023];
const dateFromStep=(year,step)=>{
  const start=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-start)/86400000;
  return new Date(start+Math.floor((days-1)*Number(step)/1000)*86400000).toISOString().slice(0,10);
};
const hasCoordinates=point=>point&&point.longitude!=null&&point.latitude!=null&&
  String(point.longitude).trim()!==''&&String(point.latitude).trim()!==''&&
  Number.isFinite(Number(point.longitude))&&Number.isFinite(Number(point.latitude))&&
  Math.abs(Number(point.longitude))<=180&&Math.abs(Number(point.latitude))<=90;

export default function TraceTerritoryPanel({scopeId='loc'}){
  const [year,setYear]=useState(2026);
  const [display,setDisplay]=useState('sources');
  const [step,setStep]=useState(1000);
  const [selectedKey,setSelectedKey]=useState('');
  const [search,setSearch]=useState('');
  const [registerOpen,setRegisterOpen]=useState(false);
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
  const totalsQuery=useAsyncResource({
    queryKey:['trace-territory-v1',year,...scopes],
    enabled:scopes.length>0&&(scopeId!=='loc'||scopeQuery.data!==undefined),
    queryFn:async()=>(await mapBounded(scopes,2,async scope=>{
      const {data,error}=await dbPublicClient.schema('silver').analytics({
        p_scope_id:scope,p_view:'trace_territory',
        p_start:period.startDate,p_end:period.endDate,p_options:{}
      });
      if(error)throw error;
      if(!Array.isArray(data))throw Error('年度來源彙整資料格式錯誤');
      return data.map(row=>({...row,source_scope:scope}));
    })).flat(),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const regions=useMemo(()=>territoryRegions(totalsQuery.data||[],year),[totalsQuery.data,year]);
  const pointGroups=useMemo(()=>territoryPointGroups(regions),[regions]);
  const pointsQuery=useAsyncResource({
    queryKey:['trace-territory-coordinates-v1',year,scopeId,
      ...pointGroups.map(group=>group.scope+':'+group.ids.join(','))],
    enabled:totalsQuery.data!==undefined&&pointGroups.length>0,
    queryFn:async()=>(await mapBounded(pointGroups,2,group=>
      readCurrentTraceAnchors(group.scope,group.ids))).flat(),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const countries=useMemo(()=>territoryWithAnchors(regions,pointsQuery.data||[]),
    [regions,pointsQuery.data]);
  const cutoff=display==='timeline'?dateFromStep(year,step):period.endDate;
  const active=useMemo(()=>countries.filter(place=>place.firstDay<=cutoff),[countries,cutoff]);
  const activeByKey=useMemo(()=>new Map(active.map(place=>[place.source_scope+':'+place.uid,place])),[active]);
  const mapped=useMemo(()=>active.filter(place=>hasCoordinates(place.point)),[active]);
  const mapData=useMemo(()=>({anchors:mapped.map(place=>({
    ...place.point,territory_total:place.total,territory_source:place.sources[0]?.name||''
  })),maps:[]}),[mapped]);
  const chosen=countries.find(place=>place.source_scope+':'+place.uid===selectedKey)||null;
  const selected=chosen&&activeByKey.has(selectedKey)?chosen:null;
  const keyOf=place=>place.source_scope+':'+place.uid;
  const selectPlace=place=>{setSelectedKey(keyOf(place));};
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
    <TraceMap key="territory" publicTrace territoryMode territoryYear={year}
      spatialData={mapData} selectedRouteUid="" showAnchorSearch={false}
      onAnchorSelect={selectPlace}
      floatingControls={<div className="loc-trace-territory-toolbar">
        <label>年度
          <select className="scope-select" value={year} onChange={event=>{
            setYear(Number(event.target.value));setStep(1000);setSelectedKey('');
          }}>{years.map(value=><option value={value} key={value}>{value} 年</option>)}</select>
        </label>
        <div role="group" aria-label="年度戰略檢視">
          <button type="button" className="loc-button" aria-pressed={display==='sources'}
            onClick={()=>setDisplay('sources')}>來源勢力</button>
          <button type="button" className="loc-button" aria-pressed={display==='timeline'}
            onClick={()=>setDisplay('timeline')}>時間推進</button>
        </div>
        <span className="scope-status">{period.startDate} ～ {period.endDate}</span>
        {display==='timeline'?<label className="loc-trace-territory-time">
          <span>文章日期推進至 {cutoff}</span>
          <input type="range" min="0" max="1000" step="1" value={step}
            aria-label="年度文章時間進度" onChange={event=>{setStep(Number(event.target.value));setSelectedKey('');}}/>
        </label>:null}
        {(totalsQuery.isPending||scopeId==='loc'&&scopeQuery.isPending||
          pointGroups.length>0&&pointsQuery.isPending)&&
          <span role="status" className="scope-status">整理年度據點中…</span>}
        {scopeQuery.error||totalsQuery.error||pointsQuery.error?
          <span role="alert" className="scope-status scope-error">年度據點資料暫時無法完整載入。</span>:null}
      </div>}>
      {selected?<section className="loc-trace-float-report loc-trace-territory-dossier"
        aria-label={selected.title+'年度據點內政'}>
        <header className="loc-trace-float-heading">
          <div><span className="loc-trace-territory-eyebrow">據點內政 · {year}</span>
            <strong>{selected.title}</strong></div>
          <button type="button" className="loc-button" aria-label="關閉據點內政"
            onClick={()=>setSelectedKey('')}>×</button>
        </header>
        <div className="loc-trace-territory-stats">
          <span>年度文章 <strong>{selected.total}</strong></span>
          <span>來源 <strong>{selected.sources.length}</strong></span>
          <span>首筆 <strong>{selected.firstDay}</strong></span>
        </div>
        {display==='sources'?<div className="loc-trace-territory-lanes" aria-label="據點文章來源比例">
          {selected.sources.map((source,i)=><div className="loc-trace-territory-lane" key={source.name}>
            <div><strong>{source.name}</strong><span>{source.count} 篇 · {source.percent.toFixed(1)}%</span></div>
            <div className="loc-trace-territory-track" role="img"
              aria-label={source.name+' 佔 '+source.percent.toFixed(1)+'%'} >
              <span style={{width:source.percent+'%','--loc-lane-index':i%5}}/>
            </div>
          </div>)}
        </div>:<ol className="loc-trace-territory-events" aria-label="文章日期序列">
          {selected.timeline.filter(row=>row.day<=cutoff).map(row=><li key={row.day}>
            <time dateTime={row.day}>{row.day}</time><span>{row.count} 篇</span>
          </li>)}
        </ol>}
        <details className="loc-trace-territory-inner-affairs" open>
          <summary>內政 · 本年度相關文章</summary>
          <TracePlaceResults
            key={keyOf(selected)+':'+year}
            place={selected.point||{uid:selected.uid,title:selected.title,
              trace_type:'space_anchor',source_scope:selected.source_scope}}
            anchors={mapData.anchors} maps={[]}
            scopeId={selected.source_scope} tab="articles" allPlacedArticles
            dateRange={period} timeMode="none" defaultSort="desc"/>
        </details>
        <p className="scope-status">依文章日期排序，不代表實際抵達或行軍路線。</p>
      </section>:null}
    </TraceMap>
      <section className="loc-trace-territory-overview" aria-label="年度版圖情報">
        <div className="loc-trace-territory-stats">
          <strong>年度版圖</strong>
          <span>{active.length} / {regions.length} 座據點</span>
          <span>{totalArticles.toLocaleString()} 篇年度文章</span>
          <span>{mapped.length} 座已定錨</span>
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
