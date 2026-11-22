'use client';
import {useMemo,useState} from 'react';
import {timeRecordHierarchy} from '../../loc/culture/time-record-hierarchy-options.mjs';

const uid=row=>String(row?.uid||'');
const title=row=>String(row?.title||row?.uid||'未命名紀錄');
const date=row=>String(row?.address||row?.attr?.date||'').slice(0,10);
const normalized=value=>String(value||'').normalize('NFKC')
  .toLocaleLowerCase('zh-Hant').trim();

// Era > Period > Date, with both parents initially collapsed.
// Toggling a parent changes presentation state only, never stored Anchor UIDs.
export default function TimeAnchorTree({rows=[],value='',disabled=false,onSelect}){
  const hierarchy=useMemo(()=>timeRecordHierarchy(rows),[rows]);
  const [openEras,setOpenEras]=useState(()=>new Set());
  const [openPeriods,setOpenPeriods]=useState(()=>new Set());
  const [openUnclassified,setOpenUnclassified]=useState(false);
  const [query,setQuery]=useState('');
  const needle=normalized(query);
  const matching=row=>normalized(title(row)+' '+(row?.type==='anchor'||row?.type==='date'?date(row):'')).includes(needle);
  const toggle=(setter,id)=>setter(previous=>{
    const next=new Set(previous);
    if(next.has(id))next.delete(id);else next.add(id);
    return next;
  });
  const edit=row=><button type="button" className="loc-time-tree-edit"
    aria-current={value===uid(row)?'true':undefined}
    disabled={disabled} onClick={()=>onSelect?.(uid(row))}>編輯</button>;
  const dateItem=row=><li key={uid(row)} className="loc-time-tree-date">
    <button type="button" className="loc-time-tree-date-choice"
      aria-current={value===uid(row)?'true':undefined}
      disabled={disabled} onClick={()=>onSelect?.(uid(row))}>
      {date(row)?<time>{date(row)}</time>:null}
      <span>{title(row)}</span>
    </button>
  </li>;
  const periodItem=branch=>{
    const row=branch.row,id=uid(row),ownMatch=matching(row);
    const filtered=needle&&!ownMatch?branch.dates.filter(matching):branch.dates;
    if(needle&&!ownMatch&&!filtered.length)return null;
    const expanded=Boolean(needle)||openPeriods.has(id);
    return <li key={id} className="loc-time-tree-period">
      <div className="loc-time-tree-heading">
        <button type="button" className="loc-time-tree-toggle"
          disabled={disabled} aria-expanded={expanded}
          onClick={()=>toggle(setOpenPeriods,id)}>
          <span className="loc-time-tree-arrow" aria-hidden="true">{expanded?'−':'+'}</span>
          <span>期間｜{title(row)}</span>
        </button>
        {edit(row)}
      </div>
      {expanded?<ul className="loc-time-tree-children">
        {filtered.length?filtered.map(dateItem):
          <li className="scope-status">此期間沒有已連結的定錨點</li>}
      </ul>:null}
    </li>;
  };
  const eraItems=hierarchy.eras.filter(group=>
    !needle||matching(group.row)||group.periods.some(period=>
      matching(period.row)||period.dates.some(matching)));
  const unclassifiedPeriods=hierarchy.unclassifiedPeriods.filter(period=>
    !needle||matching(period.row)||period.dates.some(matching));
  const unclassifiedDates=hierarchy.unclassifiedDates.filter(matching);
  const hasAny=hierarchy.eras.length||hierarchy.unclassifiedPeriods.length||
    hierarchy.unclassifiedDates.length;
  return <section className="loc-time-anchor-tree" aria-label="時間定錨階層列表">
    <label className="loc-time-tree-search">
      搜尋時代／期間／定錨點
      <input type="search" className="scope-search-input" value={query}
        onChange={event=>setQuery(event.target.value)}
        placeholder="按名稱或日期搜尋"/>
    </label>
    <ul className="loc-time-tree-roots">
      {eraItems.map(group=>{
        const row=group.row,id=uid(row),ownMatch=matching(row);
        const periods=needle&&!ownMatch?group.periods.filter(period=>
          matching(period.row)||period.dates.some(matching)):group.periods;
        const expanded=Boolean(needle)||openEras.has(id);
        return <li key={id} className="loc-time-tree-era">
          <div className="loc-time-tree-heading">
            <button type="button" className="loc-time-tree-toggle"
              disabled={disabled} aria-expanded={expanded}
              onClick={()=>toggle(setOpenEras,id)}>
              <span className="loc-time-tree-arrow" aria-hidden="true">{expanded?'−':'+'}</span>
              <span>時代｜{title(row)}</span>
            </button>
            {edit(row)}
          </div>
          {expanded?<ul className="loc-time-tree-children">
            {periods.length?periods.map(periodItem):
              <li className="scope-status">此時代沒有已連結的期間</li>}
          </ul>:null}
        </li>;
      })}
      {unclassifiedPeriods.length||unclassifiedDates.length
        ?<li className="loc-time-tree-unclassified">
          <div className="loc-time-tree-heading">
            <button type="button" className="loc-time-tree-toggle"
              disabled={disabled} aria-expanded={Boolean(needle)||openUnclassified}
              onClick={()=>setOpenUnclassified(v=>!v)}>
              <span className="loc-time-tree-arrow" aria-hidden="true">
                {needle||openUnclassified?'−':'+'}
              </span>
              <span>未分類</span>
            </button>
          </div>
          {needle||openUnclassified?<ul className="loc-time-tree-children">
            {unclassifiedPeriods.length?<li>
              <div className="loc-time-tree-subheading">未分類期間（無所屬時代）</div>
              <ul>{unclassifiedPeriods.map(periodItem)}</ul>
            </li>:null}
            {unclassifiedDates.length?<li>
              <div className="loc-time-tree-subheading">未分類定錨點（無所屬期間）</div>
              <ul>{unclassifiedDates.map(dateItem)}</ul>
            </li>:null}
          </ul>:null}
        </li>:null}
    </ul>
    {!hasAny?<p className="scope-status">目前沒有時間定錨紀錄</p>:null}
    {needle&&!eraItems.length&&!unclassifiedPeriods.length&&!unclassifiedDates.length
      ?<p className="scope-status">沒有符合的時間定錨紀錄</p>:null}
  </section>;
}
