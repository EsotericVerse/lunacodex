'use client';
import {useEffect,useMemo,useRef,useState} from 'react';

import ScopeOptionPicker from '../ScopeOptionPicker';
import {useSearchParams} from 'next/navigation';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import {useAsyncResource,useResourceCache} from '../../loc/use-async-resource';
import {useEditDock} from '../edit-dock';
import {dbAuthClient,deleteRows,insertRows,updateRows} from '../../loc/db-client.mjs';
import {revalidateServerMetadata} from '../../loc/scope-data';
import {DB_QUERY_BATCH_SIZE,selectRows} from '../../loc/db-query.mjs';
import {decodeTimeSegments,encodeTimeSegment,resolveTimeSegments,isTimeUid,allocateTimeUid} from '../../loc/time-anchor-ranges.mjs';
import {anniversarySuggestionsForDate} from '../../loc/anniversary.mjs';
import {planAnniversaryDates,collectTimeDates,collectEraPeriods} from '../../loc/culture-anchor-bulk.mjs';
import ManagementSectionNav from '../ManagementSectionNav';

const TIME_COLUMNS='uid,type,title,description,address,anchor_ids,range,invisible';
const TYPES=['anchor','period','era'];
const TYPE_TABS=[...TYPES].reverse();
const normalizeType=value=>({event:'period'}[value]||value);
const displayType={anchor:'定錨點',period:'期間',era:'時代'};
const blank=(type='anchor')=>({uid:'',type:normalizeType(type),title:'',description:'',address:'',anchor_ids:[],invisible:false});
const day=value=>value?String(value).slice(0,10):'';
function normalizeDraft(row){
  if(!row)return blank();
  return {...blank(row.type),...row,address:day(row.address),
    anchor_ids:Array.isArray(row.anchor_ids)?row.anchor_ids:[]};
}
export default function CultureTimelineEditor({
  scopeId='',timeTable:providedTimeTable='',birthday='',selectedRecordId='',suggestedAnchorDate='',
  suggestedRecordType='anchor',suggestedRequestNonce=0,defaultRecordType='anchor',onClose=null,onDataChanged=null
}){
  useUiSection('uiExtra.dataErrors');
  const copy=useUiCopy();
  const editDock=useEditDock();
  const resourceCache=useResourceCache();
  const searchParams=useSearchParams();
  const routeAnchorDate=String(searchParams?.get?.('anchorDate')||'').slice(0,10);
  const effectiveAnchorDate=day(suggestedAnchorDate||(!selectedRecordId?routeAnchorDate:''));
  const dataScope=String(scopeId||'').trim();
  // Timeline editor expects legacy Time fields projected from unified Anchor.
  // Direct *_anchor reads cannot select the removed address/anchor_ids columns.
  const timeTable=String(providedTimeTable||'').trim().replace(/_anchor$/,'_time');
  const editable=Boolean(dataScope&&dataScope!=='loc'&&timeTable);
  const defaultType=TYPES.includes(normalizeType(defaultRecordType))?normalizeType(defaultRecordType):'anchor';
  const [draft,setDraft]=useState(()=>blank(defaultType));
  const [selectedId,setSelectedId]=useState('');
  const [browseType,setBrowseType]=useState(defaultType);
  const [busy,setBusy]=useState(false);
  const [visibilitySelection,setVisibilitySelection]=useState([]);
  const [visibilityBusy,setVisibilityBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [organizedDates,setOrganizedDates]=useState([]);
  const [annual,setAnnual]=useState({title:'',originDate:'',startYear:'',endYear:'',firstAnniversary:'1',lastAnniversary:'5'});
  const [annualOpen,setAnnualOpen]=useState(false);
  const [tracePairs,setTracePairs]=useState([]);
  const [pairFrom,setPairFrom]=useState(null);
  const [pairTo,setPairTo]=useState(null);
  const original=useRef(blank(defaultType));
  const requestSeen=useRef('');
  const lastExternalSelectedId=useRef('');
  const dockActions=useRef({save:null,isDirty:()=>false,isBusy:()=>false});
  const editorRef=useRef(null),inputRef=useRef(null);

  const query=useAsyncResource({
    queryKey:['culture-period-settings',dataScope,timeTable],
    enabled:editable,
    queryFn:async()=>{
      const {rows}=await selectRows(timeTable,{
        columns:TIME_COLUMNS,filters:[{column:'type',operator:'in',value:TYPES}],
        limit:DB_QUERY_BATCH_SIZE,offset:0,authenticated:true
      });
      return rows;
    }
  });
  const all=query.data||[];
  const anchors=useMemo(()=>new Map(all.filter(row=>row.type==='anchor').map(row=>[String(row.uid),row])),[all]);
  const eventChoices=useMemo(()=>[...all].filter(row=>row.type==='period'),[all]);
  const eventByUid=useMemo(()=>new Map(eventChoices.map(row=>[String(row.uid),row])),[eventChoices]);
  const anchorChoices=useMemo(()=>[...anchors.values()]
    .sort((a,b)=>day(a.address).localeCompare(day(b.address))),[anchors]);
  const anniversarySuggestions=useMemo(()=>
    !selectedId&&draft.type==='anchor'
      ?anniversarySuggestionsForDate(day(draft.address),anchorChoices,{birthday})
      :[],[selectedId,draft.type,draft.address,anchorChoices,birthday]);
  const anchorOptions=useMemo(()=>anchorChoices.map(row=>
    ({value:row.uid,label:(day(row.address)?day(row.address)+'｜':'')+row.title})),[anchorChoices]);
  const anchorOptionOf=uid=>anchorOptions.find(option=>option.value===uid)
    ||(uid?{value:uid,label:'已失效：'+uid}:null);
  const periodKeyOf=ids=>[...ids].sort().join(',');
  const existingPeriodByPair=useMemo(()=>{
    const map=new Map();
    for(const period of eventChoices){
      const ids=(Array.isArray(period.anchor_ids)?period.anchor_ids:[]).filter(Boolean);
      if(ids.length===2)map.set(periodKeyOf(ids),period.uid);
    }
    return map;
  },[eventChoices]);
  const rows=useMemo(()=>[...all].sort((a,b)=>{
    const position=row=>{
      if(row.type==='anchor')return day(row.address);
      const eventRanges=eventChoices.map(event=>({...event,ranges:resolveTimeSegments(event.anchor_ids,anchors,{period:false})}));
      return row.type==='era'
        ?(row.anchor_ids||[]).flatMap(id=>eventRanges.find(event=>event.uid===id)?.ranges||[])
          .map(range=>range.start_date).filter(Boolean).sort()[0]||'9999-12-31'
        :resolveTimeSegments(row.anchor_ids,anchors,{period:false})
          .map(range=>range.start_date).filter(Boolean).sort()[0]||'9999-12-31';
    };
    return position(a).localeCompare(position(b));
  }),[all,anchors,eventChoices]);
  const recordOptions=useMemo(()=>rows.filter(row=>row.type===browseType).map(row=>({
    value:String(row.uid),
    label:(row.type==='anchor'&&day(row.address)?day(row.address)+'｜':'')+String(row.title||'未命名紀錄')
  })),[rows,browseType]);
  const selectRow=id=>{
    const row=all.find(item=>String(item.uid)===String(id));
    if(!row)return;
    if(String(id)!==selectedId&&dockActions.current.isDirty()
      &&!window.confirm('切換紀錄會捨棄尚未儲存的修改，確定繼續？'))return;
    onClose?.();
    setSelectedId(String(id));setBrowseType(row.type);setVisibilitySelection([]);
    setTracePairs([]);setPairFrom(null);setPairTo(null);
    const next=normalizeDraft(row);
    original.current=next;setDraft(next);setMessage('');
  };
  useEffect(()=>{
    const id=String(selectedRecordId||'').trim();
    if(!id){lastExternalSelectedId.current='';return;}
    if(!all.length||id===lastExternalSelectedId.current)return;
    const row=all.find(item=>String(item.uid)===id);
    if(row){
      lastExternalSelectedId.current=id;
      const next=normalizeDraft(row);
      setSelectedId(id);setBrowseType(row.type);setVisibilitySelection([]);original.current=next;setDraft(next);setMessage('');
      setTracePairs([]);setPairFrom(null);setPairTo(null);
    }
  },[selectedRecordId,all]);
  useEffect(()=>{
    const preferred=normalizeType(suggestedRecordType);
    const type=TYPES.includes(preferred)?preferred:'anchor';
    if(selectedRecordId||(!effectiveAnchorDate&&!suggestedRequestNonce))return;
    const key=[suggestedRequestNonce,effectiveAnchorDate,type].join(':');
    if(requestSeen.current===key)return;
    requestSeen.current=key;
    const fresh={...blank(type),address:type==='anchor'?effectiveAnchorDate:''};
    setDraft(fresh);original.current=fresh;setSelectedId('');setBrowseType(type);setMessage('');
    setTracePairs([]);setPairFrom(null);setPairTo(null);
  },[suggestedRecordType,suggestedRequestNonce,effectiveAnchorDate,selectedRecordId]);
  useEffect(()=>{
    if(!editable||(!selectedRecordId&&!suggestedRequestNonce))return;
    editorRef.current?.scrollIntoView({block:'nearest'});
    inputRef.current?.focus({preventScroll:true});
  },[editable,selectedRecordId,suggestedRequestNonce]);
  useEffect(()=>{
    if(!editDock?.active||editDock.scopeId!==scopeId)return undefined;
    return editDock.register({
      save:options=>dockActions.current.save(options),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[editDock?.active,editDock?.scopeId,editDock?.register,scopeId]);
  if(!editable)return null;

  const startNew=type=>{
    const fresh=blank(type);
    original.current=fresh;setDraft(fresh);setSelectedId('');setBrowseType(type);setMessage('');
    setTracePairs([]);setPairFrom(null);setPairTo(null);setOrganizedDates([]);
  };
  const reset=()=>{startNew(browseType);onClose?.();};
  const switchBrowseType=type=>{
    if(type===browseType)return;
    if(dockActions.current.isDirty()&&!window.confirm('切換類型會捨棄尚未儲存的修改，確定繼續？'))return;
    startNew(type);setVisibilitySelection([]);onClose?.();
  };
  const beginNew=()=>{
    if(dockActions.current.isDirty()&&!window.confirm('新增紀錄會捨棄尚未儲存的修改，確定繼續？'))return;
    startNew(browseType);onClose?.();
  };
  const change=(key,value)=>setDraft(row=>({...row,[key]:value}));
  const segments=draft.type==='era'
    ?draft.anchor_ids.map(uid=>({start:uid,end:'',raw:uid}))
    :decodeTimeSegments(draft.anchor_ids);
  const setSegments=next=>change('anchor_ids',draft.type==='era'
    ?next.map(range=>range.start)
    :(next.length?encodeTimeSegment(next[0].start,next[0].end):[]));
  const updateSegment=(index,key,value)=>{
    const copy=segments.map(row=>({...row}));
    copy[index][key]=value;
    if(copy[index].end===copy[index].start)copy[index].end='';
    if(!copy[index].start)return;
    setSegments(copy);
  };
  const addSegment=()=>{
    const choices=draft.type==='era'?eventChoices:anchorChoices;
    if(!choices.length)return;
    if(draft.type==='period'&&segments.length)return;
    setSegments([...segments,{start:String(choices[0].uid),end:''}]);
  };
  const addPair=()=>{
    const from=pairFrom?.value,to=pairTo?.value;
    if(!from||!to||from===to)return;
    if(tracePairs.some(pair=>periodKeyOf(pair)===periodKeyOf([from,to])))return;
    setTracePairs(items=>[...items,[from,to]]);setPairFrom(null);setPairTo(null);
  };
  const removePair=index=>setTracePairs(items=>items.filter((_,i)=>i!==index));
  // A complete scoped read is only issued after pressing an explicit bulk tool.
  const loadTimeRecords=async()=>{
    const gathered=[];
    for(let offset=0;offset<100000;offset+=DB_QUERY_BATCH_SIZE){
      const {rows=[]}=await selectRows(timeTable,{
        columns:TIME_COLUMNS,filters:[{column:'type',operator:'in',value:TYPES}],
        limit:DB_QUERY_BATCH_SIZE,offset,authenticated:true
      });
      gathered.push(...rows);
      if(rows.length<DB_QUERY_BATCH_SIZE)return gathered;
    }
    throw Error('時間紀錄過多，無法確認完整性；已停止寫入。');
  };
  const autoOrganize=async()=>{
    if(busy||!['period','era'].includes(draft.type))return;
    setBusy(true);setMessage('');setOrganizedDates([]);
    try{
      const complete=await loadTimeRecords();
      const points=complete.filter(x=>x.type==='anchor');
      const periods=complete.filter(x=>x.type==='period');
      const datesByUid=new Map(points.map(x=>[x.uid,x]));
      const datesForPeriod=period=>{
        const endpoints=(period.anchor_ids||[]).map(uid=>datesByUid.get(uid)?.address)
          .filter(Boolean).sort();
        return endpoints.length?collectTimeDates(endpoints[0],endpoints.at(-1),points):[];
      };
      if(draft.type==='period'){
        const ids=Array.isArray(draft.anchor_ids)?draft.anchor_ids:[];
        const window={anchor_ids:ids};
        const found=datesForPeriod(window);
        setOrganizedDates(found);
        setMessage('區間內已有 '+found.length+' 個真實日期定錨。期間仍以起迄 UID 表示，沒有新增或改動任何紀錄。');
      }else{
        const ids=(draft.anchor_ids||[]).filter(uid=>periods.some(p=>p.uid===uid));
        if(!ids.length)throw Error('請先選擇時代包含的期間，以決定整理區間。');
        const matching=collectEraPeriods(ids,periods,points);
        const found=[...new Map(matching.flatMap(datesForPeriod).map(x=>[x.uid,x])).values()]
          .sort((a,b)=>String(a.address).localeCompare(String(b.address)));
        // Era stores period UIDs only. Date members are derived, never appended to this list.
        change('anchor_ids',matching.map(x=>x.uid));
        setOrganizedDates(found);
        setMessage('已整理 '+matching.length+' 個期間、'+found.length+' 個真實日期定錨。請按「儲存修改」確認時代關聯。');
      }
      // Reload the river's current database view after each bulk inspection;
      // proposed Era links remain a draft until the existing Save action.
      await onDataChanged?.();
    }catch(error){setMessage(error?.message||'整理失敗');}
    finally{setBusy(false);}
  };
  const createAnnualBatch=async()=>{
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      const plans=planAnniversaryDates(annual);
      if(!plans.length)throw Error('選擇的範圍內沒有符合的週年日期。');
      const complete=await loadTimeRecords();
      const knownDays=new Set(complete.filter(x=>x.type==='anchor').map(x=>day(x.address)));
      const occupied=[...complete];
      const additions=[];
      for(const item of plans){
        if(knownDays.has(item.date))continue;
        const uid=allocateTimeUid(occupied);
        const record={uid,type:'anchor',title:item.title,description:null,
          address:item.date,anchor_ids:null,invisible:false};
        additions.push(record);occupied.push(record);knownDays.add(item.date);
      }
      if(additions.length&&!window.confirm('將新增 '+additions.length+' 個日期定錨，另有 '+
        (plans.length-additions.length)+' 個日期已存在而跳過。確定建立？'))return;
      // Keep the same managed Scope write path and never touch Galaxy.
      for(let i=0;i<additions.length;i+=100)
        await insertRows(timeTable,additions.slice(i,i+100));
      refresh();
      await onDataChanged?.();
      setAnnualOpen(false);startNew('anchor');
      setMessage('已建立 '+additions.length+' 個紀念日定錨，跳過 '+
        (plans.length-additions.length)+' 個既有日期。');
    }catch(error){setMessage(error?.message||'批次建立失敗');}
    finally{setBusy(false);}
  };
  const refresh=()=>{
    if(dataScope!=='local')void revalidateServerMetadata();
    // Never hold the Save lock while refetching UI data.
    // In-place revalidation keeps existing records visible during refresh.
    void Promise.allSettled([
      resourceCache.revalidate({queryKey:['culture-timeline',scopeId]}),
      resourceCache.revalidate({queryKey:['culture-period-settings',dataScope,timeTable]}),
      resourceCache.revalidate({queryKey:['culture-time-periods',scopeId]}),
      resourceCache.revalidate({queryKey:['culture-period-roots','v2',scopeId]}),
      resourceCache.revalidate({queryKey:['culture-period-source-snapshot','v6',scopeId]})
    ]);
  };
  const save=async(event)=>{
    event.preventDefault?.();
    if(busy||query.isPending)return false;
    setBusy(true);setMessage('');
    try{
      const title=String(draft.title||'').trim();
      if(!title)throw new Error('請輸入名稱');
      const type=String(draft.type||'');
      if(!TYPES.includes(type))throw new Error('不支援的時間紀錄類型');
      const payload={type,title,description:String(draft.description||'').trim()||null,
        address:null,anchor_ids:null,invisible:Boolean(draft.invisible)};
      let extraPeriodRows=[];
      if(type==='anchor'){
        const timeDate=day(draft.address);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(timeDate))throw new Error('請先指定有效的定錨日期');
        payload.address=timeDate;
      }else{
        if(draft.type==='period'&&!anchorChoices.length)throw new Error('請先建立時間定錨點');
        if(draft.type==='era'&&!segments.length&&!tracePairs.length&&!eventChoices.length)
          throw new Error('請先建立期間');
        if(draft.type==='era'&&!segments.length&&!tracePairs.length)
          throw new Error('請先加入期間，或用定錨點連線加入');
        if(draft.type==='period'&&!segments.length)throw new Error('請加入一個或兩個時間定錨點');
        if(draft.type==='period'&&segments.length!==1)throw new Error('期間只能有一個起點及可選的結束錨點');
        const unchangedLinks=Boolean(selectedId)&&
          JSON.stringify(draft.anchor_ids)===JSON.stringify(original.current.anchor_ids);
        for(const segment of segments){
          const source=draft.type==='era'?eventByUid:anchors;
          if(!isTimeUid(segment.start)||!source.has(segment.start)&&!unchangedLinks)
            throw new Error('找不到引用的定錨點或期間：'+segment.start);
          if(draft.type==='era'){
            if(segment.end)throw new Error('時代只列期間 UID，不另外寫日期。');
            continue;
          }
          if(segment.end&&!anchors.has(segment.end)&&!unchangedLinks)
            throw new Error('找不到結束定錨點：'+segment.end);
          if(segment.end&&anchors.has(segment.start)&&anchors.has(segment.end)&&
            day(anchors.get(segment.end)?.address)<=day(anchors.get(segment.start)?.address))
            throw new Error('結束定錨點必須晚於起始定錨點');
        }
        let pairPeriodUids=[];
        if(draft.type==='era'&&tracePairs.length){
          if(tracePairs.some(pair=>!anchors.has(pair[0])||!anchors.has(pair[1])))
            throw new Error('連線的定錨點有已失效的，請移除');
          for(const pair of tracePairs){
            const existingUid=existingPeriodByPair.get(periodKeyOf(pair));
            if(existingUid){pairPeriodUids.push(existingUid);continue;}
            const uid=allocateTimeUid([...all,...extraPeriodRows]);
            const [a,b]=pair;
            const titleA=anchors.get(a)?.title||a,titleB=anchors.get(b)?.title||b;
            extraPeriodRows.push({uid,type:'period',title:titleA+' → '+titleB,
              description:null,address:null,anchor_ids:encodeTimeSegment(a,b)});
            pairPeriodUids.push(uid);
          }
        }
        payload.anchor_ids=draft.type==='era'
          ?[...segments.map(segment=>segment.start),...pairPeriodUids]
          :encodeTimeSegment(segments[0].start,segments[0].end);
      }
      if(extraPeriodRows.length)await insertRows(timeTable,extraPeriodRows);
      if(selectedId){
        await updateRows(timeTable,payload,{filters:[{column:'uid',operator:'eq',value:selectedId}]});
      }else{
        await insertRows(timeTable,[{uid:allocateTimeUid([...all,...extraPeriodRows]),...payload}]);
      }
      refresh();reset();
      await onDataChanged?.();
      setMessage('已儲存，時間長河已更新。');return true;
    }catch(error){setMessage(error?.message||'儲存失敗');editDock?.setNotice?.(error?.message||'儲存失敗');return false;}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    if(!selectedId||busy)return;
    setBusy(true);setMessage('');
    try{
      // Periods survive anchor deletion; only their affected UID links become invalid.
      await deleteRows(timeTable,{filters:[{column:'uid',operator:'eq',value:selectedId}]});
      refresh();reset();
      await onDataChanged?.();
      setMessage('已刪除，時間長河已更新。');
    }catch(error){setMessage(error?.message||'刪除失敗');}
    finally{setBusy(false);}
  };
  const bulkSetVisibility=async invisible=>{
    if(!['lo3rwang','lrunes'].includes(dataScope)||visibilityBusy||!visibilitySelection.length)return;
    if(!window.confirm('確定批次設定 '+visibilitySelection.length+' 筆時間紀錄的顯示或隱藏？'))return;
    setVisibilityBusy(true);setMessage('');
    try{
      let count=0;
      for(let i=0;i<visibilitySelection.length;i+=150){
        const ids=visibilitySelection.slice(i,i+150);
        const {data,error}=await dbAuthClient.schema('silver').from(dataScope+'_time')
          .update({invisible}).in('uid',ids).select('uid');
        if(error)throw error;
        if(data.length!==ids.length)throw Error('部分時間紀錄未成功寫入');
        count+=data.length;
      }
      void query.mutate();refresh();
      await onDataChanged?.();
      setVisibilitySelection([]);setMessage('已更新 '+count+' 筆時間隱藏設定。');
    }catch(e){setMessage(String(e.message||e));}finally{setVisibilityBusy(false);}
  };
  dockActions.current={save:()=>save({preventDefault(){}}),
    isDirty:()=>JSON.stringify(draft)!==JSON.stringify(original.current),
    isBusy:()=>busy};
  return <section ref={editorRef} className="scope-culture-inline-editor" role="region" aria-label="時間定錨、期間與時代編輯">
    <header className="scope-culture-inline-heading">
      <h4>{selectedId?'編輯':'新增'}{displayType[draft.type]}</h4>
    </header>
    {query.error?<p className="scope-status scope-error" role="alert">{query.error.message}</p>:null}
    <div className="scope-culture-record-browser">
      <ManagementSectionNav id="time-kind-sections" title="時間紀錄類型"
        panelId="time-kind-panel" value={browseType}
        items={TYPE_TABS.map(type=>({
          value:type,label:displayType[type]+' · '+all.filter(row=>row.type===type).length
        }))}
        onChange={next=>{if(!busy)switchBrowseType(next);}}/>
      <div id="time-kind-panel" className="scope-culture-record-browser-row">
        <div className="scope-culture-record-browser-select">
          <label htmlFor="culture-record-search">現有{displayType[browseType]}（依名稱搜尋）</label>
          <ScopeOptionPicker id="culture-record-search" options={recordOptions}
            disabled={query.isPending||busy} value={selectedId}
            onChange={id=>id?selectRow(id):beginNew()}
            placeholder={'搜尋'+displayType[browseType]+'名稱'}
            noOptionsMessage={recordOptions.length?'沒有符合項目':'此類型尚無紀錄'}/>
        </div>
        <button type="button" className="loc-button"
          disabled={busy} onClick={beginNew}>＋ 新增{displayType[browseType]}</button>
        {browseType==='anchor'?<button type="button" className="loc-button" disabled={busy}
          onClick={()=>setAnnualOpen(v=>!v)}>＋ 建議紀念日</button>:null}
      </div>
    </div>
    {annualOpen&&browseType==='anchor'?<div className="scope-card" role="group" aria-label="建議紀念日批次建立">
      <h5>建議紀念日｜批次建立真實日期定錨</h5>
      <p className="scope-status">僅在按下建立後寫入 date。相同日期已存在就略過，不修改文章或期間。</p>
      <div className="scope-culture-quick-primary">
        <label>紀念日名稱<input className="scope-search-input" value={annual.title}
          onChange={e=>setAnnual(v=>({...v,title:e.target.value}))}/></label>
        <label>原始日期<input type="date" className="scope-select" value={annual.originDate}
          onChange={e=>setAnnual(v=>({...v,originDate:e.target.value}))}/></label>
        {[['startYear','起始年份'],['endYear','結束年份'],['firstAnniversary','起始週年'],['lastAnniversary','結束週年']].map(([key,label])=>
          <label key={key}>{label}<input type="number" className="scope-search-input" value={annual[key]}
            onChange={e=>setAnnual(v=>({...v,[key]:e.target.value}))}/></label>)}
        <button type="button" className="loc-button" disabled={busy} onClick={createAnnualBatch}>建立週年時間</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>setAnnualOpen(false)}>取消</button>
      </div>
    </div>:null}
    {query.isPending?<p className="scope-status" role="status">{copy.uiExtra.dataErrors.loading}</p>:null}
    <details className="scope-card">
      <summary>大量隱藏／公開{displayType[browseType]}（已選 {visibilitySelection.length} 筆）</summary>
      <div className="scope-stat-controls">
        <button type="button" className="loc-button" disabled={visibilityBusy} onClick={()=>setVisibilitySelection(rows.filter(row=>row.type===browseType).map(row=>row.uid))}>全部勾選</button>
        <button type="button" className="loc-button" disabled={visibilityBusy} onClick={()=>setVisibilitySelection([])}>清除勾選</button>

        <button type="button" className="loc-button" disabled={visibilityBusy||!visibilitySelection.length} onClick={()=>bulkSetVisibility(true)}>大量隱藏</button>
        <button type="button" className="loc-button" disabled={visibilityBusy||!visibilitySelection.length} onClick={()=>bulkSetVisibility(false)}>大量公開</button>
      </div>
      <div style={{maxHeight:'16rem',overflow:'auto'}}>
        {rows.filter(row=>row.type===browseType).map(row=><label key={row.uid} style={{display:'block'}}>
          <input type="checkbox" checked={visibilitySelection.includes(row.uid)} disabled={visibilityBusy}
            onChange={e=>setVisibilitySelection(ids=>e.target.checked?[...ids.filter(uid=>uid!==row.uid),row.uid]:ids.filter(uid=>uid!==row.uid))}/>
          {displayType[row.type]}｜{row.title} · {row.uid}
        </label>)}
      </div>
    </details>
    <form className="scope-culture-quick-form" onSubmit={event=>event.preventDefault()}>
      <div className="scope-culture-quick-primary">
        <label className="scope-culture-quick-name">名稱
          <input ref={inputRef} className="scope-search-input" value={draft.title} required
            onChange={event=>change('title',event.target.value)}/>
        </label>
        <label>可見性
          <select className="scope-select" value={Number(Boolean(draft.invisible))} onChange={e=>change('invisible',e.target.value==='1')}>
            <option value={0}>顯示</option><option value={1}>隱藏</option>
          </select>
        </label>
        {draft.type==='anchor'?<label>定錨日期
          <input className="scope-select" type="date" required value={day(draft.address)}
            onChange={event=>change('address',event.target.value)}/>
        </label>:null}
      </div>
      {!selectedId&&draft.type==='anchor'&&anniversarySuggestions.length
        ?<div className="scope-status" role="group" aria-label="週年紀念虛擬定錨建議">
          <strong>週年紀念建議（虛擬定錨，尚未儲存）</strong>
          {anniversarySuggestions.map(item=><div key={item.sourceUid+':'+item.date}>
            <span>{item.title}｜原始定錨 {item.sourceDate}</span>
            <button type="button" className="loc-button" disabled={busy}
              onClick={()=>change('title',item.title)}>套用建議</button>
          </div>)}
        </div>:null}
      {draft.type!=='anchor'?<div className="scope-culture-quick-anchors">
        <button type="button" className="loc-button" disabled={busy||query.isPending}
          onClick={autoOrganize}>自動整理</button>
        {organizedDates.length?<details className="scope-card">
          <summary>區間內真實日期定錨（{organizedDates.length}）</summary>
          <div style={{maxHeight:'14rem',overflow:'auto'}}>
            {organizedDates.map(point=><div key={point.uid}>{day(point.address)}｜{point.title}</div>)}
          </div>
        </details>:null}
        {draft.type==='period'&&!anchorChoices.length
          ?<p className="scope-status scope-error">請先建立時間定錨點，才能新增期間。</p>:null}
        {segments.map((segment,index)=><div key={index} className="scope-culture-quick-primary">
          <label>{draft.type==='era'?'第 '+(index+1)+' 個期間':'起點'}
            <ScopeOptionPicker
              options={draft.type==='era'?eventChoices.map(row=>({value:row.uid,label:'期間｜'+row.title})):anchorOptions}
              value={segment.start} onChange={id=>updateSegment(index,'start',id)}
              allowClear={false}
              placeholder={draft.type==='era'?'搜尋期間標題':'搜尋定錨點標題'}
              noOptionsMessage="沒有符合項目"/>
          </label>
          {draft.type==='period'?<label>結束（可只有單一定錨點）
            <ScopeOptionPicker
              options={anchorOptions.filter(option=>option.value!==segment.start)}
              value={segment.end||''} onChange={id=>updateSegment(index,'end',id)}
              placeholder="搜尋定錨點標題（單一定錨點留空）"
              noOptionsMessage="沒有符合項目"/>
          </label>:null}
          <button type="button" className="loc-button"
            onClick={()=>setSegments(segments.filter((_,i)=>i!==index))}>移除</button>
        </div>)}
        <button type="button" className="loc-button"
          disabled={draft.type==='era'?!eventChoices.length:!anchorChoices.length||segments.length>0}
          onClick={addSegment}>{draft.type==='era'?'＋ 加入期間':'＋ 新增期間定錨點'}</button>
        {segments.some(seg=>draft.type==='era'
          ?!eventByUid.has(seg.start)
          :resolveTimeSegments(draft.anchor_ids,anchors).some(r=>r.invalid))?
          <p className="scope-status scope-error">部分定錨點連線已失效，請修正對應區間。</p>:null}
        {draft.type==='era'?<div className="scope-culture-quick-anchor-connect">
          <h5>或：用定錨點連線加入（自動建立對應期間）</h5>
          {!anchorChoices.length?<p className="scope-status scope-error">請先建立時間定錨點。</p>:
          <div className="scope-culture-quick-primary">
            <label>起點
              <ScopeOptionPicker options={anchorOptions}
                value={pairFrom?.value||''} onChange={id=>setPairFrom(anchorOptionOf(id))}
                placeholder="搜尋定錨點標題" noOptionsMessage="沒有符合項目"/>
            </label>
            <label>終點
              <ScopeOptionPicker options={anchorOptions.filter(option=>option.value!==pairFrom?.value)}
                value={pairTo?.value||''} onChange={id=>setPairTo(anchorOptionOf(id))}
                placeholder="搜尋定錨點標題" noOptionsMessage="沒有符合項目"/>
            </label>
            <button type="button" className="loc-button"
              disabled={!pairFrom||!pairTo||pairFrom.value===pairTo?.value}
              onClick={addPair}>＋ 加入連線</button>
          </div>}
          <div className="scope-culture-quick-anchor-connect-list">
            {tracePairs.map((pair,index)=><div key={pair.join(':')+':'+index} className="scope-culture-quick-anchor-connect-item">
              <span>{anchors.get(pair[0])?.title||pair[0]} — {anchors.get(pair[1])?.title||pair[1]}
                {existingPeriodByPair.has(periodKeyOf(pair))?'（沿用既有期間）':'（存檔時自動建立期間）'}</span>
              <button type="button" className="loc-button" onClick={()=>removePair(index)}>移除</button>
            </div>)}
          </div>
        </div>:null}
      </div>:null}
      <label className="scope-culture-quick-notes">說明
        <textarea className="scope-search-input" rows={3} value={draft.description||''}
          onChange={event=>change('description',event.target.value)}/>
      </label>
      {message?<p className="scope-status" role="status" aria-live="polite">{message}</p>:null}
      {selectedId?<div className="scope-culture-quick-actions">
        <button type="button" className="loc-button" onClick={remove} disabled={busy}>刪除</button>
      </div>:null}
    </form>
  </section>;
}
