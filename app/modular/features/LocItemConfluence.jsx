'use client';
import {useFeatureCopy,useUiLocale} from '../../i18n/ui-locale';
import {translateUiField} from '../../i18n/ui-copy';
import featureZh from '../../i18n/feature-sections/itemConfluence.zh_tw.js';

import {useEffect,useMemo,useState} from 'react';
import {useAsyncResource} from '../../../zenstack/client-queries';
import {selectManagedScopes} from '../../loc/scope-data';
import {selectLocItemDailySeries} from '../../loc/item-confluence-query';
import {realMoonPhase} from '../../loc/model/moon-phase';
import {buildReferencedMoonRiver} from '../../lrunes/daily-moon-river.mjs';
import {
  ITEM_CONFLUENCE_PAGE_SIZE,ITEM_LANE_OPTIONS,itemConfluenceShiftMonth,
  validateItemConfluenceRange,validateItemLane,itemLaneDescription,
  buildItemConfluenceDaily,buildItemConfluenceRiver,itemConfluenceSummary,itemRuneDisplay
} from '../../loc/item-confluence-model.mjs';
import CultureTimeline from '../modules/culture-timeline/CultureTimeline';

const EMPTY_SCOPES=Object.freeze([]);
const EMPTY_FOCUS=Object.freeze({});
function nowInTaipei(){
  try{
    const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date()).filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
    return fields.year+'-'+fields.month+'-'+fields.day;
  }catch{return new Date().toISOString().slice(0,10);}
}
function labelOf(row){return String(row?.display_label||'');}
function laneDayText(row,index,lane,l){
  if(lane?.source==='daily:rune'){
    const draws=row?.runeDraws?.[index]||[];
    return draws.length?draws.map(itemRuneDisplay).join(' ／ '):l.noneToday;
  }
  const count=Number(row?.counts?.[index])||0;
  return count.toLocaleString()+l.recordUnit+((Number(row?.ratios?.[index])||0)*100).toFixed(1)+'%';
}
function laneColumnLabel(lane,l){
  return lane?.source==='daily:rune'?l.runeColumn:l.mediaColumn;
}
function defaultLane(scopeId,source){return {scopeId,source,exact:''};}
function LanePicker({label,lane,scopes,onChange}){
  const l=useFeatureCopy('itemConfluence',featureZh);
  const scopeOptions=scopes.filter(scope=>scope.id!=='loc');
  const sourceOptions=ITEM_LANE_OPTIONS.filter(option=>option.value!=='daily:rune'||lane.scopeId==='lrunes');
  return <fieldset className="scope-card" style={{minWidth:0,flex:'1 1 250px'}}>
    <legend>{label}</legend>
    <div className="scope-stat-controls">
      <label><span>Scope</span>
        <select className="scope-select" value={lane.scopeId} onChange={event=>{
          const id=event.target.value;
          onChange({...lane,scopeId:id,source:lane.source==='daily:rune'&&id!=='lrunes'?'galaxy:all':lane.source});
        }}>
          {!scopeOptions.some(scope=>scope.id===lane.scopeId)?<option value="">{l.select}</option>:null}
          {scopeOptions.map(scope=><option key={scope.id} value={scope.id}>{scope.id}</option>)}
        </select>
      </label>
      <label><span>{l.laneItem}</span>
        <select className="scope-select" value={sourceOptions.some(item=>item.value===lane.source)?lane.source:'galaxy:all'}
          onChange={event=>onChange({...lane,source:event.target.value,exact:''})}>
          {sourceOptions.map(option=><option key={option.value} value={option.value}>{l[({ 'galaxy:facebook':'galaxyFacebook','galaxy:threads':'galaxyThreads','galaxy:instagram':'galaxyInstagram','galaxy:all':'galaxyAll','galaxy:exact':'galaxyExact','media:all':'mediaAll','media:exact':'mediaExact','daily:rune':'dailyRune'})[option.value]]||option.label}</option>)}
        </select>
      </label>
      {lane.source.endsWith(':exact')?<label><span>{l.exactType}</span>
        <input className="scope-input" value={lane.exact} maxLength={100} placeholder={lane.source.startsWith('media:')?'媒體類型':'site'}
          onChange={event=>onChange({...lane,exact:event.target.value})}/>
      </label>:null}
    </div>
  </fieldset>;
}
export default function LocItemConfluence(){
  const l=useFeatureCopy('itemConfluence',featureZh);
  const {locale}=useUiLocale();
  const today=useMemo(nowInTaipei,[]);
  const [startDate,setStartDate]=useState(()=>itemConfluenceShiftMonth(nowInTaipei(),-3));
  const [endDate,setEndDate]=useState(today);
  const [laneA,setLaneA]=useState(()=>defaultLane('','galaxy:all'));
  const [laneB,setLaneB]=useState(()=>defaultLane('','galaxy:all'));
  const [selectedDay,setSelectedDay]=useState('');
  const [page,setPage]=useState(1);
  const scopesQuery=useAsyncResource(['managed-scopes'],selectManagedScopes);
  const scopes=scopesQuery.data||EMPTY_SCOPES;
  const range=useMemo(()=>validateItemConfluenceRange(startDate,endDate),[startDate,endDate]);
  const selectionA=useMemo(()=>validateItemLane(laneA,scopes),[laneA,scopes]);
  const selectionB=useMemo(()=>validateItemLane(laneB,scopes),[laneB,scopes]);
  const valid=range.valid&&selectionA.valid&&selectionB.valid;
  const selectedA=scopes.find(scope=>scope.id===laneA.scopeId)||null;
  const selectedB=scopes.find(scope=>scope.id===laneB.scopeId)||null;
  const query=useAsyncResource(valid&&selectedA&&selectedB
    ?['loc-item-confluence',range.startDate,range.endDate,laneA.scopeId,laneA.source,laneA.exact,laneB.scopeId,laneB.source,laneB.exact]
    :null,()=>Promise.all([
      selectLocItemDailySeries({scope:selectedA,lane:laneA,startDate:range.startDate,endDate:range.endDate,knownScopes:scopes}),
      selectLocItemDailySeries({scope:selectedB,lane:laneB,startDate:range.startDate,endDate:range.endDate,knownScopes:scopes})
    ]));
  const labels=useMemo(()=>[laneA,laneB].map(lane=>{
    const label=itemLaneDescription(lane);
    const option=ITEM_LANE_OPTIONS.find(item=>item.value===lane.source);
    const keys={'galaxy:facebook':'galaxyFacebook','galaxy:threads':'galaxyThreads','galaxy:instagram':'galaxyInstagram','galaxy:all':'galaxyAll','galaxy:exact':'galaxyExact','media:all':'mediaAll','media:exact':'mediaExact','daily:rune':'dailyRune'};
    return String(lane.scopeId||'')+' · '+(lane.source.endsWith(':exact')?(lane.source.startsWith('media:')?l.mediaLabel:l.textLabel)+String(lane.exact||''):(l[keys[option?.value]]||label||l.unselected));
  }),[laneA,laneB,l]);
  const daily=useMemo(()=>valid&&query.data?buildItemConfluenceDaily({
    startDate:range.startDate,endDate:range.endDate,lanes:[laneA,laneB],series:query.data
  }):[],[valid,query.data,range.startDate,range.endDate,laneA,laneB]);
  const river=useMemo(()=>buildItemConfluenceRiver(daily,labels,[laneA,laneB]),[daily,labels,laneA,laneB]);
  const runeRecordCount=useMemo(()=>river.reduce((count,item)=>
    count+(item.entry_type==='item_daily_rune'?(item.daily_draws?.length||0):0),0
  ),[river]);
  const moonRiver=useMemo(()=>valid&&query.isSuccess?buildReferencedMoonRiver(
    range.startDate,range.endDate,[laneA,laneB],
    date=>realMoonPhase(new Date(date+'T12:00:00+08:00')),runeRecordCount
  ):[],[valid,query.isSuccess,range.startDate,range.endDate,laneA.scopeId,laneA.source,laneB.scopeId,laneB.source,runeRecordCount]);
  const combinedRiver=useMemo(()=>[...moonRiver,...river],[moonRiver,river]);
  const summary=useMemo(()=>itemConfluenceSummary(daily),[daily]);
  const lanes=[laneA,laneB];
  const selectedRow=daily.find(row=>row.day===selectedDay)||null;
  const totalPages=Math.max(1,Math.ceil(daily.length/ITEM_CONFLUENCE_PAGE_SIZE));
  const visibleRows=daily.slice((page-1)*ITEM_CONFLUENCE_PAGE_SIZE,page*ITEM_CONFLUENCE_PAGE_SIZE);
  useEffect(()=>{setPage(1);setSelectedDay('');},
    [startDate,endDate,laneA.scopeId,laneA.source,laneA.exact,laneB.scopeId,laneB.source,laneB.exact]);
  const invalidMessage=!range.valid?translateUiField(locale,range.reason):!selectionA.valid?(l.streamA+': '+translateUiField(locale,selectionA.reason)):!selectionB.valid?(l.streamB+': '+translateUiField(locale,selectionB.reason)):'';

  return <section className="scope-card scope-culture-classification-river scope-loc-time-river" aria-label={l.aria}>
    <p className="loc-eyebrow">LOC Culture · {l.eyebrow}</p>
    <h3>{l.title}</h3>
    <p className="scope-status">{l.instructions}</p>
    <div className="scope-stat-controls" style={{alignItems:'stretch'}}>
      <LanePicker label={l.streamA} lane={laneA} scopes={scopes} onChange={setLaneA}/>
      <LanePicker label={l.streamB} lane={laneB} scopes={scopes} onChange={setLaneB}/>
    </div>
    <div className="scope-stat-controls">
      <label><span>{l.startDate}</span><input className="scope-input" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)}/></label>
      <label><span>{l.endDate}</span><input className="scope-input" type="date" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label>
      <span className="scope-status">{l.limit}</span>
    </div>
    {scopesQuery.isPending?<p className="scope-status">{l.loadingScopes}</p>:null}
    {scopesQuery.error?<p className="scope-status scope-error">{l.scopeError}{String(scopesQuery.error.message||scopesQuery.error)}</p>:null}
    {!scopesQuery.isPending&&!scopesQuery.error&&invalidMessage?<p className="scope-status scope-error" role="alert">{invalidMessage}</p>:null}
    {valid&&query.isPending?<p className="scope-status">{l.reading}</p>:null}
    {query.error&&valid?<p className="scope-status scope-error" role="alert">{l.readError}{String(query.error.message||query.error)}</p>:null}
    {valid&&query.data&&!query.error?<div>
      <p className="scope-status">{range.startDate} ～ {range.endDate} · {lanes.map((lane,index)=>{
        const total=summary.totals[index];
        return l.streamPrefix+(index===0?'A':'B')+' '+(lane.source==='daily:rune'
          ?daily.filter(row=>row.runeDraws?.[index]?.length).length+l.runeDays
          :total.toLocaleString()+l.entries);
      }).join(' · ')}{l.bothDays}{summary.bothActiveDays}{l.dayUnit}</p>
      <p className="scope-status">{l.note}</p>
      {combinedRiver.length?<CultureTimeline
        items={combinedRiver}
        labelOf={labelOf}
        focus={EMPTY_FOCUS}
        mode="source"
        windowStart={range.startDate}
        windowEnd={(()=>{
          const date=new Date(range.endDate+'T00:00:00Z');
          date.setUTCDate(date.getUTCDate()+1);
          return date.toISOString().slice(0,10);
        })()}
        fixedMin={range.startDate}
        fixedMax={(()=>{
          const date=new Date(range.endDate+'T00:00:00Z');
          date.setUTCDate(date.getUTCDate()+1);
          return date.toISOString().slice(0,10);
        })()}
        onSelect={item=>setSelectedDay(String(item?.start||'').slice(0,10))}
      />:<p className="scope-status">{l.empty}</p>}
      {selectedRow?<div className="scope-card" role="status" aria-live="polite">
        <p className="scope-status">{l.selectedDay}{selectedDay}</p>
        {lanes.map((lane,index)=><p className="scope-status" key={index}>
          <strong>{labels[index]}：</strong> {laneDayText(selectedRow,index,lane,l)}
        </p>)}
      </div>:null}
      <h4>{l.dailyData}</h4>
      <div className="scope-culture-source-work-scroll">
        <table className="scope-stat-table">
          <thead><tr><th scope="col">{l.date}</th>
            {lanes.map((lane,index)=><th key={index} scope="col">{l.streamPrefix}{index===0?'A':'B'} · {laneColumnLabel(lane,l)}</th>)}
          </tr></thead>
          <tbody>{visibleRows.map(row=><tr key={row.day}>
            <th scope="row"><button type="button" className="loc-button" onClick={()=>setSelectedDay(row.day)}>{row.day}</button></th>
            {lanes.map((lane,index)=><td key={index}>{laneDayText(row,index,lane,l)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="scope-stat-controls" aria-label={l.pagination}>
        <button type="button" className="loc-button" disabled={page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>{l.previous}</button>
        <span className="scope-status">{l.page}{page}/{totalPages}{l.pages}{ITEM_CONFLUENCE_PAGE_SIZE}{l.pageDays}</span>
        <button type="button" className="loc-button" disabled={page>=totalPages} onClick={()=>setPage(value=>Math.min(totalPages,value+1))}>{l.next}</button>
      </nav>
    </div>:null}
  </section>;
}
