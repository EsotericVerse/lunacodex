'use client';
import {useMemo,useState} from 'react';
import {spaceRecordHierarchy} from './space-record-hierarchy.mjs';

const uid=row=>String(row?.uid||'');
const name=row=>String(row?.title||row?.uid||'未命名紀錄');
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();

// One spatial browser, matching the TimeAnchor tree presentation. All links
// are read-only projections of saved UID relations; editing stays in the
// original Point/Path/Trace editors.
export default function SpaceAnchorTree({spatial,scopeId,value='',disabled=false,onSelect}){
  const hierarchy=useMemo(()=>spaceRecordHierarchy(spatial,scopeId),[spatial,scopeId]);
  const [openTraces,setOpenTraces]=useState(()=>new Set());
  const [openPaths,setOpenPaths]=useState(()=>new Set());
  const [openUnclassified,setOpenUnclassified]=useState(false);
  const [query,setQuery]=useState('');
  const needle=normalize(query);
  const matches=row=>normalize([name(row),uid(row),row?.postal_address||''].join(' ')).includes(needle);
  const toggle=(setter,id)=>setter(previous=>{
    const next=new Set(previous);
    if(next.has(id))next.delete(id);else next.add(id);
    return next;
  });
  const choose=(type,row)=>onSelect?.(type,uid(row));
  const edit=(type,row)=><button type="button" className="loc-time-tree-edit"
    disabled={disabled} aria-current={value===type+':'+uid(row)?'true':undefined}
    onClick={()=>choose(type,row)}>編輯</button>;
  const pointItem=(row,parentKey)=><li key={parentKey+':'+uid(row)} className="loc-time-tree-date">
    <button type="button" className="loc-time-tree-date-choice"
      aria-current={value==='point:'+uid(row)?'true':undefined}
      disabled={disabled} onClick={()=>choose('point',row)}>
      <span>{name(row)}{row.invisible?'（已隱藏）':''}</span>
      {row.postal_address?<span className="scope-status">{row.postal_address}</span>:null}
    </button>
  </li>;
  const pathItem=(branch,parentKey,showAll=false)=>{
    const row=branch.row,id=uid(row),ownMatch=matches(row);
    const visible=needle&&!showAll&&!ownMatch?branch.points.filter(matches):branch.points;
    if(needle&&!showAll&&!ownMatch&&!visible.length)return null;
    const expanded=Boolean(needle)||openPaths.has(id);
    return <li key={parentKey+':'+id} className="loc-time-tree-period">
      <div className="loc-time-tree-heading">
        <button type="button" className="loc-time-tree-toggle" disabled={disabled}
          aria-expanded={expanded} onClick={()=>toggle(setOpenPaths,id)}>
          <span className="loc-time-tree-arrow" aria-hidden="true">{expanded?'−':'+'}</span>
          <span>路徑｜{name(row)}{row.invisible?'（已隱藏）':''}</span>
        </button>
        {edit('path',row)}
      </div>
      {expanded?<ul className="loc-time-tree-children">
        {visible.length?visible.map(point=>pointItem(point,parentKey+':'+id)):
          <li className="scope-status">此路徑沒有已連結的空間定錨點</li>}
      </ul>:null}
    </li>;
  };
  const traceItems=hierarchy.traces.filter(group=>!needle||matches(group.row)||
    group.paths.some(path=>matches(path.row)||path.points.some(matches))||
    group.directPoints.some(matches));
  const unclassifiedPaths=hierarchy.unclassifiedPaths.filter(branch=>!needle||
    matches(branch.row)||branch.points.some(matches));
  const unclassifiedPoints=hierarchy.unclassifiedPoints.filter(row=>!needle||matches(row));
  const hasAny=hierarchy.traces.length||hierarchy.unclassifiedPaths.length||
    hierarchy.unclassifiedPoints.length;
  return <section className="loc-time-anchor-tree loc-space-anchor-tree" aria-label="空間定錨階層列表">
    <label className="loc-time-tree-search">
      搜尋痕跡／路徑／空間定錨點
      <input className="scope-search-input" type="search" value={query}
        onChange={event=>setQuery(event.target.value)} placeholder="依名稱、地址或 UID 搜尋"/>
    </label>
    <ul className="loc-time-tree-roots">
      {traceItems.map(group=>{
        const row=group.row,id=uid(row),ownMatch=matches(row);
        const paths=needle&&!ownMatch?group.paths.filter(path=>
          matches(path.row)||path.points.some(matches)):group.paths;
        const direct=needle&&!ownMatch?group.directPoints.filter(matches):group.directPoints;
        const expanded=Boolean(needle)||openTraces.has(id);
        return <li key={id} className="loc-time-tree-era">
          <div className="loc-time-tree-heading">
            <button type="button" className="loc-time-tree-toggle"
              disabled={disabled} aria-expanded={expanded}
              onClick={()=>toggle(setOpenTraces,id)}>
              <span className="loc-time-tree-arrow" aria-hidden="true">{expanded?'−':'+'}</span>
              <span>痕跡｜{name(row)}{row.invisible?'（已隱藏）':''}</span>
            </button>
            {edit('trace',row)}
          </div>
          {expanded?<ul className="loc-time-tree-children">
            {paths.map(path=>pathItem(path,id,ownMatch))}
            {direct.length?<li className="loc-time-tree-unclassified">
              <div className="loc-time-tree-subheading">直接連線的定錨點</div>
              <ul>{direct.map(point=>pointItem(point,id+':direct'))}</ul>
            </li>:null}
            {!paths.length&&!direct.length?<li className="scope-status">此痕跡沒有已連結的路徑或定錨點</li>:null}
          </ul>:null}
        </li>;
      })}
      {unclassifiedPaths.length||unclassifiedPoints.length
        ?<li className="loc-time-tree-unclassified">
          <div className="loc-time-tree-heading">
            <button type="button" className="loc-time-tree-toggle"
              disabled={disabled} aria-expanded={Boolean(needle)||openUnclassified}
              onClick={()=>setOpenUnclassified(v=>!v)}>
              <span className="loc-time-tree-arrow" aria-hidden="true">
                {needle||openUnclassified?'−':'+'}
              </span>
              <span>未歸屬</span>
            </button>
          </div>
          {needle||openUnclassified?<ul className="loc-time-tree-children">
            {unclassifiedPaths.length?<li>
              <div className="loc-time-tree-subheading">未歸屬路徑（沒有隸屬痕跡）</div>
              <ul>{unclassifiedPaths.map(path=>pathItem(path,'unclassified'))}</ul>
            </li>:null}
            {unclassifiedPoints.length?<li>
              <div className="loc-time-tree-subheading">未歸屬定錨點（沒有隸屬路徑或痕跡）</div>
              <ul>{unclassifiedPoints.map(point=>pointItem(point,'unclassified'))}</ul>
            </li>:null}
          </ul>:null}
        </li>:null}
    </ul>
    {!hasAny?<p className="scope-status">目前沒有空間定錨紀錄</p>:null}
    {needle&&!traceItems.length&&!unclassifiedPaths.length&&!unclassifiedPoints.length
      ?<p className="scope-status">沒有符合的空間定錨紀錄</p>:null}
  </section>;
}
