'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {FeaturePage} from '../../modular/ui';
import ScopeLink from '../../modular/ScopeLink';
import {featureNavigationHref} from '../../modular/routing/feature-navigation';
import {queryLocCultureTimeRiver,queryLocCultureDensity}
  from '../actions/culture/queries.mjs';
import {readPublicSourceTaxonomy} from '../source/catalog-public.mjs';
import {publicCultureSourceModel} from '../culture/public-source-river.mjs';
import {
  buildLocEraIndex,buildLocEraRiver,locEraWindows,mergeLocCultureDensityRows
} from '../culture/loc-group-river.mjs';
import {DEFAULT_YEAR_WINDOW} from '../preferences/default-year-window.mjs';
import {TERRITORY_STOPS,territoryLegendColor} from '../../modular/visual-palette.mjs';

const CultureTimeline=dynamic(()=>import('../../modular/modules/culture-timeline/CultureTimeline'),{
  loading:()=> <div className='scope-culture-density-loading' role='status' aria-busy='true'>
    <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
    <span>正在準備時間長河…</span>
  </div>
});
const EMPTY=Object.freeze([]);
const NO_FOCUS=Object.freeze({});
const YEAR_WINDOWS=Object.freeze([Object.freeze({
  startDate:DEFAULT_YEAR_WINDOW.startDate,endDate:DEFAULT_YEAR_WINDOW.endDate
})]);
function rangeBounds(windows=[]){
  const starts=windows.map(row=>row.startDate).filter(Boolean).sort();
  const ends=windows.map(row=>row.endDate).filter(Boolean).sort();
  return {start:starts[0]||DEFAULT_YEAR_WINDOW.startDate,
    end:ends.at(-1)||DEFAULT_YEAR_WINDOW.endDate};
}
function mergeTimeRows(indexRows=[],rangeRows=[]){
  const rows=new Map();
  for(const row of [...indexRows,...rangeRows]){
    const key=String(row.scope_id||'')+':'+String(row.uid||'');
    if(key!==':')rows.set(key,row);
  }
  return [...rows.values()];
}

export default function LocGroupCultureReader(){
  const [indexRows,setIndexRows]=useState(EMPTY);
  const [rangeRows,setRangeRows]=useState(EMPTY);
  const [densityRows,setDensityRows]=useState(EMPTY);
  const [taxonomy,setTaxonomy]=useState(null);
  const [activeEraKey,setActiveEraKey]=useState('');
  const [rangeWindows,setRangeWindows]=useState(YEAR_WINDOWS);
  const [expandedSources,setExpandedSources]=useState(EMPTY);
  const [selectedSource,setSelectedSource]=useState(null);
  const [pending,setPending]=useState(true);
  const [error,setError]=useState('');
  const sequence=useRef(0);
  const mounted=useRef(true);

  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;sequence.current++;};
  },[]);

  const eras=useMemo(()=>buildLocEraIndex(indexRows),[indexRows]);
  const activeEra=activeEraKey?eras.find(row=>row.key===activeEraKey)||null:null;
  const activeEraIndex=activeEra?eras.findIndex(row=>row.key===activeEra.key):-1;
  const bounds=useMemo(()=>rangeBounds(rangeWindows),[rangeWindows]);
  const timeRiver=useMemo(()=>buildLocEraRiver(
    mergeTimeRows(indexRows,rangeRows),activeEra?.key||'',rangeWindows
  ),[indexRows,rangeRows,activeEra?.key,rangeWindows]);
  const daily=useMemo(()=>mergeLocCultureDensityRows(densityRows),[densityRows]);
  const sourceRiver=useMemo(()=>publicCultureSourceModel(
    daily,taxonomy,expandedSources,bounds.start,bounds.end
  ),[daily,taxonomy,expandedSources,bounds.start,bounds.end]);
  const sourceOrder=timeRiver.groups.length+2;
  const groups=useMemo(()=>[
    ...timeRiver.groups,
    ...sourceRiver.groups.map((group,index)=>({
      ...group,
      order:sourceOrder+(Number.isFinite(Number(group.order))?Number(group.order):index),
      className:[group.className,'scope-culture-source-layer'].filter(Boolean).join(' ')
    }))
  ],[timeRiver.groups,sourceRiver.groups,sourceOrder]);
  const items=useMemo(()=>[
    ...timeRiver.items,
    ...sourceRiver.items.map(item=>({...item,
      group_order:sourceOrder+(Number(item.group_order)||0)}))
  ],[timeRiver.items,sourceRiver.items,sourceOrder]);
  const selectedSourceScopes=useMemo(()=>{
    if(!selectedSource)return [];
    const names=new Set(selectedSource.sites||[]);
    const counts=new Map();
    for(const row of densityRows){
      if(!names.has(String(row.site||'')))continue;
      const scope=String(row.scope_id||'');
      const count=Number(row.item_count)||0;
      if(scope&&count)counts.set(scope,(counts.get(scope)||0)+count);
    }
    return [...counts].map(([scope,item_count])=>({scope,item_count}))
      .sort((a,b)=>b.item_count-a.item_count||a.scope.localeCompare(b.scope));
  },[selectedSource,densityRows]);

  useEffect(()=>{
    let active=true;
    const request=++sequence.current;
    const load=async()=>{
      setPending(true);setError('');
      try{
        const [timeResult,densityResult,taxonomyResult]=await Promise.all([
          queryLocCultureTimeRiver({mode:'index',ranges:YEAR_WINDOWS}),
          queryLocCultureDensity({ranges:YEAR_WINDOWS}),
          readPublicSourceTaxonomy()
        ]);
        if(!active||request!==sequence.current)return;
        const rows=Array.isArray(timeResult?.data?.rows)?timeResult.data.rows:[];
        const choices=buildLocEraIndex(rows);
        const yearStart=DEFAULT_YEAR_WINDOW.startDate,yearEnd=DEFAULT_YEAR_WINDOW.endDate;
        const current=choices.find(era=>era.ranges.some(range=>
          String(range.end_date||range.start_date)>=yearStart&&
          String(range.start_date)<=yearEnd))||null;
        setIndexRows(rows);
        setTaxonomy(taxonomyResult||null);
        setActiveEraKey(current?.key||'');
        setRangeRows(EMPTY);
        setRangeWindows(YEAR_WINDOWS);
        setDensityRows(Array.isArray(densityResult?.data?.rows)?densityResult.data.rows:[]);
        setExpandedSources([]);
        setSelectedSource(null);
      }catch(reason){
        if(active&&request===sequence.current)setError(String(reason?.message||reason));
      }finally{
        if(active&&request===sequence.current)setPending(false);
      }
    };
    void load();
    return()=>{active=false;sequence.current++;};
  },[]);

  const navigateEra=useCallback(async direction=>{
    if(pending||!eras.length)return;
    const current=activeEraIndex;
    const nextIndex=current<0
      ?(direction==='previous'?0:-1)
      :direction==='previous'?current+1:current-1;
    if(nextIndex<0||nextIndex>=eras.length)return;
    const next=eras[nextIndex],windows=locEraWindows(next);
    if(!windows.length){
      setError('這個時代沒有有效的時間區間，無法載入河道。');
      return;
    }
    const request=++sequence.current;
    setPending(true);setError('');
    // Keep the current vis-timeline mounted and visible until BOTH bounded
    // queries finish. The two datasets are committed atomically below.
    try{
      const [timeResult,densityResult]=await Promise.all([
        queryLocCultureTimeRiver({mode:'range',ranges:windows}),
        queryLocCultureDensity({ranges:windows})
      ]);
      if(!mounted.current||request!==sequence.current)return;
      setActiveEraKey(next.key);
      setRangeWindows(windows);
      setRangeRows(Array.isArray(timeResult?.data?.rows)?timeResult.data.rows:[]);
      setDensityRows(Array.isArray(densityResult?.data?.rows)?densityResult.data.rows:[]);
      setExpandedSources([]);
      setSelectedSource(null);
    }catch(reason){
      if(mounted.current&&request===sequence.current)
        setError(String(reason?.message||reason));
    }finally{
      if(mounted.current&&request===sequence.current)setPending(false);
    }
  },[pending,eras,activeEraIndex]);

  const toggleSource=group=>{
    const id=String(group||'');
    if(!id.startsWith('dual:source:'))return;
    const uid=id.slice('dual:source:'.length);
    setExpandedSources(current=>current.includes(uid)
      ?current.filter(value=>value!==uid):[...current,uid]);
  };
  const selectSource=group=>{
    const id=String(group||'');
    if(!id.startsWith('dual:source:'))return;
    setSelectedSource(sourceRiver.sites.find(row=>row.key===id)||null);
  };

  const canRender=Boolean(indexRows.length||items.length);
  return <FeaturePage featureId='culture'>
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      <div className='scope-culture-river-toolbar'>
        <div>
          <p className='loc-eyebrow'>LOCLucus · TLucus</p>
          <h3>文化時間長河</h3>
        </div>
        {activeEra?<div className='scope-culture-river-era-caption' aria-live='polite'>
          <strong>{activeEra.title}</strong>
          <span>{activeEra.scope_id} · {bounds.start} ～ {bounds.end}</span>
        </div>:<span className='scope-status'>{DEFAULT_YEAR_WINDOW.label}</span>}
      </div>
      {error?<p className='scope-status scope-error' role='alert'>{error}</p>:null}
      {pending&&!canRender?<div className='scope-culture-density-loading' role='status' aria-live='polite' aria-busy='true'>
        <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
        <span>正在載入時間定錨與文章密度…</span>
      </div>:null}
      {pending&&canRender?<p className='scope-status' role='status' aria-live='polite'>
        正在切換時代；目前河道保持顯示。</p>:null}
      {!pending&&!error&&!activeEra?<p className='scope-status'>{eras.length
        ?'目前顯示近一年；可使用河道左側箭頭回溯較早時代。'
        :'目前尚未建立可顯示的時代定錨。'}</p>:null}
      {taxonomy&&canRender?<div className='scope-culture-layer-legend' role='group' aria-label='時間與文章密度圖例'>
        <div className='scope-culture-layer-legend__time'>
          <span><i className='is-era' aria-hidden='true'/>時代</span>
          <span><i className='is-period' aria-hidden='true'/>期間</span>
          <span><i className='is-lucus' aria-hidden='true'/>時間定錨</span>
        </div>
        <div className='scope-culture-layer-legend__density' aria-label='單日文章數密度'>
          {TERRITORY_STOPS.map(([minimum],index)=>{
            const maximum=TERRITORY_STOPS[index+1]?.[0];
            const label=minimum===0?'1–2':maximum?`${minimum}–${maximum-1}`:`${minimum}+`;
            return <span key={minimum}><i style={{background:territoryLegendColor(index)}} aria-hidden='true'/>{label} 篇</span>;
          })}
        </div>
      </div>:null}
      {canRender?<CultureTimeline
        items={items}
        eraRanges={timeRiver.items}
        extraGroups={groups}
        focus={NO_FOCUS}
        mode='source'
        heightVariant='double'
        naturalSourceHeight
        stackItems
        windowStart={bounds.start}
        windowEnd={bounds.end}
        onEraNavigate={eras.length?direction=>void navigateEra(direction):null}
        eraNavigationDisabled={{
          previous:pending||!eras.length||activeEraIndex>=eras.length-1,
          next:pending||activeEraIndex<=0
        }}
        onGroupToggle={toggleSource}
        onGroupSelect={selectSource}
      />:null}
      {selectedSource?<section className='scope-card scope-culture-source-detail'>
        <div className='scope-culture-source-detail-heading'>
          <h4>{selectedSource.label} · 來源分布</h4>
          <button type='button' className='loc-button' onClick={()=>setSelectedSource(null)}>收合</button>
        </div>
        {selectedSourceScopes.length?<nav className='scope-result-links' aria-label='來源所屬 Scope'>
          {selectedSourceScopes.map(row=><ScopeLink key={row.scope}
            href={featureNavigationHref(row.scope,'culture')}>
            {row.scope} · {row.item_count.toLocaleString()} 篇
          </ScopeLink>)}
        </nav>:<p className='scope-status'>此來源目前沒有可連結的 Scope。</p>}
      </section>:null}
    </section>
  </FeaturePage>;
}
