'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {dbAuthClient,dbAuthEvents} from './db-client.mjs';
import {readAllTraceAnchors} from '../modular/features/trace/trace-data';
import {useAsyncResource,useResourceCache} from './use-async-resource';
import {revalidateServerMetadata} from './scope-data';
import {EDIT_OPERATION_TTL_MS,assertEditorSession} from './edit-session-ttl.mjs';
import {TIMELINE_IO,MAX_TIMELINE_BYTES} from './query-batch-size.mjs';
import {saveTimelineReviewSession,loadTimelineReviewSession,clearTimelineReviewSession,timelineReviewCacheOversized} from './timeline-review-session.mjs';
import {accumulateTimelineArticles,groupTimelineMissingPlaces,selectedTimelineArticleUpdates} from './timeline-place-matcher.mjs';
import {galaxyReadColumnsFor} from '../../zenstack/galaxy-read-models.mjs';

// Keep request and response sizes bounded during browser-side review.
const RESULT_PAGE=Math.min(TIMELINE_IO.previewPage,500);
const WRITE_BATCH=Math.min(TIMELINE_IO.writeBatch,500);
const friendlyError=e=>String(e?.message||e||'未知錯誤');
function checked(result,label){
  if(result.error)throw Error(label+'：'+result.error.message);
  return result.data;
}
export default function TimelinePlaceManager({scopeId}){
  const [selectedFile,setSelectedFile]=useState(null);
  const [rangeStart,setRangeStart]=useState('');
  const [rangeEnd,setRangeEnd]=useState('');
  const [analyzing,setAnalyzing]=useState(false);
  const [writing,setWriting]=useState(false);
  const [progress,setProgress]=useState(null);
  const [analysis,setAnalysis]=useState(null);
  const [groupChoices,setGroupChoices]=useState({});
  const [bulkPlaceId,setBulkPlaceId]=useState('');
  const [itemChoices,setItemChoices]=useState({});
  const [excluded,setExcluded]=useState({});
  const [groupPages,setGroupPages]=useState({});
  const [page,setPage]=useState(0);
  const [notice,setNotice]=useState('');
  const [writeProgress,setWriteProgress]=useState(null);
  const [completedCount,setCompletedCount]=useState(0);
  const [sessionEnabled,setSessionEnabled]=useState(false);
  const [sessionReady,setSessionReady]=useState(false);
  const [sessionOwner,setSessionOwner]=useState('');
  const [sessionWarning,setSessionWarning]=useState('');
  const runRef=useRef(0);
  const analyzeTimerRef=useRef(null);
  const workerRef=useRef(null);
  const fileRef=useRef(null);
  const abortWorker=()=>workerRef.current?.abort();
  useEffect(()=>()=>{
    runRef.current++;
    workerRef.current?.abort();
    if(analyzeTimerRef.current!==null)clearTimeout(analyzeTimerRef.current);
  },[]);
  function parseInWorker(file,anchors,startDate,endDate){
    if(typeof Worker==='undefined')throw Error('此瀏覽器不支援背景解析 JSON');
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./timeline-analysis.worker.mjs',import.meta.url),{type:'module'});
      let finished=false;
      const finish=(result,error)=>{
        if(finished)return;
        finished=true;
        worker.terminate();
        if(workerRef.current?.worker===worker)workerRef.current=null;
        if(error)reject(error);else resolve(result);
      };
      workerRef.current={worker,abort:()=>finish(null,Error('已取消 JSON 分析'))};
      worker.onmessage=event=>{
        const data=event.data;
        if(data?.ok)finish(data);
        else finish(null,Error(data?.error||'JSON 背景解析失敗'));
      };
      worker.onerror=event=>finish(null,Error(event?.message||'JSON 背景處理器載入失敗'));
      worker.onmessageerror=()=>finish(null,Error('JSON 背景處理器回傳資料失敗'));
      try{worker.postMessage({file,anchors,startDate,endDate});}catch(error){finish(null,error);}
    });
  }
  const cache=useResourceCache();
  useEffect(()=>{
    let active=true;
    dbAuthEvents.getUser().then(({data})=>{
      if(!active)return;
      const owner=data?.user?.id||'';
      const tooLarge=owner&&timelineReviewCacheOversized(sessionStorage,scopeId);
      const snapshot=owner&&!tooLarge?loadTimelineReviewSession(sessionStorage,{scopeId,owner}):null;
      setSessionOwner(owner);
      if(tooLarge)setSessionWarning('先前的審查暫存過大，已略過自動恢復，原資料未刪除；可以重新選檔分析。');
      if(snapshot){
        setAnalysis(snapshot.analysis);
        setGroupChoices(snapshot.groupChoices||{});
        setItemChoices(snapshot.itemChoices||{});
        setExcluded(snapshot.excluded||{});
        setCompletedCount(snapshot.completedCount||0);
        setSessionEnabled(true);
        setNotice('已恢復本分頁暫存的審查結果，請確認地點後再寫入。');
      }
      setSessionReady(true);
    }).catch(()=>{if(active)setSessionReady(true);});
    return ()=>{active=false;};
  },[scopeId]);
  useEffect(()=>{
    if(!sessionReady)return;
    if(!sessionEnabled)return;
    if(!sessionOwner||!analysis)return;
    const save=setTimeout(()=>{
      try{
        const saved=saveTimelineReviewSession(sessionStorage,{scopeId,owner:sessionOwner,analysis,
          groupChoices,itemChoices,excluded,completedCount});
        if(!saved)throw Error('審查資料超出安全暫存大小');
        setSessionWarning('');
      }catch{
        setSessionWarning('本次資料超過瀏覽器暫存容量，重新整理仍須重新比對；原始 Timeline 不會上傳。');
      }
    },writing?0:400);
    return ()=>clearTimeout(save);
  },[scopeId,sessionReady,sessionEnabled,sessionOwner,analysis,groupChoices,itemChoices,excluded,completedCount,writing]);
  const enabled=['lo3rwang','lrunes'].includes(scopeId);
  const anchorQuery=useAsyncResource(['timeline-place-anchors-owner',scopeId],()=>{
    return readAllTraceAnchors(scopeId,{includeHidden:true});
  },{enabled,revalidateOnFocus:false,revalidateOnReconnect:false});
  const eligible=useMemo(()=>(anchorQuery.data||[]).filter(row=>
    row.trace_type==='space_anchor'&&Array.isArray(row.address)&&row.address.length===2
    &&row.address.every(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)))),[anchorQuery.data]);
  function onToggleSessionCache(checked){
    if(!checked){
      try{clearTimelineReviewSession(sessionStorage,scopeId);}catch{}
      setSessionWarning('');
    }
    setSessionEnabled(checked);
  }
  function reset(){
    runRef.current++;
    abortWorker();
    try{clearTimelineReviewSession(sessionStorage,scopeId);}catch{}
    setSessionEnabled(false);setSessionWarning('');
    setSelectedFile(null);setAnalysis(null);setGroupChoices({});setBulkPlaceId('');setItemChoices({});setExcluded({});setGroupPages({});setProgress(null);setNotice('');setPage(0);setWriteProgress(null);setCompletedCount(0);
    if(fileRef.current)fileRef.current.value='';
  }
  async function analyze(){
    if(!enabled||!selectedFile||analyzing||writing||anchorQuery.isPending)return;
    const from=Date.parse(rangeStart+'T00:00:00.000Z');
    const through=Date.parse(rangeEnd+'T00:00:00.000Z');
    const yearLater=new Date(from);
    if(!Number.isFinite(from)||!Number.isFinite(through)){
      setNotice('請先指定有效的起訖日期');return;
    }
    yearLater.setUTCFullYear(yearLater.getUTCFullYear()+1);
    if(through<from||through>yearLater.getTime()){
      setNotice('時間範圍最多一年，且結束日期不得早於開始日期');return;
    }
    if(!eligible.length){setNotice('目前沒有具有座標的空間定錨點，因此沒有可補寫的 place_id。');return;}
    const run=++runRef.current;
    const timer=setTimeout(()=>{
      if(run!==runRef.current)return;
      runRef.current++;
      abortWorker();
      setAnalyzing(false);
      setProgress(null);
      setNotice('Timeline 地點比對超過 5 分鐘，已停止。尚未寫入任何資料。');
    },EDIT_OPERATION_TTL_MS);
    analyzeTimerRef.current=timer;
    setAnalyzing(true);setAnalysis(null);setGroupChoices({});setBulkPlaceId('');setItemChoices({});setExcluded({});setGroupPages({});setPage(0);setNotice('');setWriteProgress(null);setCompletedCount(0);
    try{
      if(selectedFile.size>MAX_TIMELINE_BYTES)throw Error('Timeline JSON 超過檔案大小上限，請按年度拆分後匯入');
      setProgress({done:0,total:0,message:'正在瀏覽器背景處理 Timeline JSON…'});
      const {visitCount,matched}=await parseInWorker(selectedFile,eligible,rangeStart,rangeEnd);
      if(run!==runRef.current)return;
      const windows=matched.windows;
      if(!windows.length){
        setAnalysis({ready:[],disputes:[],unchanged:[],visitCount,
          empty:matched.withoutAnchor,ambiguous:0,articleCount:0});
        setNotice('沒有任何 Timeline 造訪點落在既有空間定錨點 500 公尺內；不更新文章。');
        return;
      }
      const startDate=rangeStart;
      const nextDate=new Date(Date.parse(rangeEnd+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
      const articleMatches=[];
      const windowsByDay=new Map();
      for(const window of windows){
        const start=Date.parse(window.from),end=Date.parse(window.to);
        for(let day=Math.floor(start/86400000);day<=Math.floor((end-1)/86400000);day++){
          const key=new Date(day*86400000).toISOString().slice(0,10);
          if(!windowsByDay.has(key))windowsByDay.set(key,[]);
          windowsByDay.get(key).push({...window,startMs:start,endMs:end});
        }
      }
      // Use the existing Galaxy.date B-tree for a single annual scan.
      // Keep the result locally for exact visit-time matching: no per-window database calls.
      let offset=0;
      while(true){
        if(run!==runRef.current)return;
        const result=await dbAuthClient.schema('silver').from(scopeId+'_galaxy')
          .select(galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor').join(','))
          .gte('date',startDate).lt('date',nextDate)
          .order('date',{ascending:true}).order('createtime',{ascending:true})
          .range(offset,offset+RESULT_PAGE-1);
        const rows=checked(result,'查詢年度文章');
        if(!Array.isArray(rows))throw Error('年度文章查詢結果無效');
        for(const row of rows){
          if(row.place_id&&String(row.place_id).trim())continue;
          const timestamp=Date.parse(String(row.createtime||''));
          if(!Number.isFinite(timestamp))continue;
          // Visit intervals were already filtered against Point coordinates in the worker.
          const articleDay=new Date(timestamp).toISOString().slice(0,10);
          for(const window of windowsByDay.get(articleDay)||[]){
            if(window.startMs<=timestamp&&timestamp<window.endMs){
              articleMatches.push({
                uid:row.uid,title:row.title,createtime:row.createtime,
                place_id:row.place_id,window
              });
            }
          }
        }
        if(rows.length<RESULT_PAGE)break;
        offset+=RESULT_PAGE;
        if(offset>100000)throw Error('單一年度文章超過查詢上限');
        setProgress({done:offset,total:0,message:'已讀取 '+offset.toLocaleString()+' 篇年度文章，比對造訪時間…'});
      }
      if(run!==runRef.current)return;
      const classified=accumulateTimelineArticles(articleMatches);
      setAnalysis({...classified,visitCount,empty:matched.withoutAnchor,
        ambiguous:matched.ambiguousWindows,articleCount:classified.ready.length+
        classified.disputes.length+classified.unchanged.length});
      setNotice('已完成地點預覽。依既有空間定錨點集中審查；有歧義的地點才需要額外確認。');
    }catch(e){
      if(run===runRef.current)setNotice('地點比對失敗：'+friendlyError(e));
    }finally{
      clearTimeout(timer);
      if(run===runRef.current){analyzeTimerRef.current=null;setAnalyzing(false);}
    }
  }
  const ready=analysis?.ready||[];
  const reviewGroups=useMemo(()=>groupTimelineMissingPlaces(analysis),[analysis]);
  const selectedUpdates=useMemo(
    ()=>selectedTimelineArticleUpdates(reviewGroups,groupChoices,itemChoices,excluded),
    [reviewGroups,groupChoices,itemChoices,excluded]);
  const canWrite=selectedUpdates.length>0;
  const bulkRows=useMemo(()=>{
    if(!bulkPlaceId)return [];
    return [...(analysis?.ready||[]),...(analysis?.disputes||[])].filter(row=>
      row.candidates.some(candidate=>candidate.uid===bulkPlaceId)&&
      (!row.existingPlaceId||row.existingPlaceId===bulkPlaceId));
  },[analysis,bulkPlaceId]);
  const applyBulkPlace=()=>{
    if(!bulkPlaceId||!bulkRows.length||writing)return;
    setItemChoices(current=>{
      const next={...current};
      for(const row of bulkRows)next[row.uid]=bulkPlaceId;
      return next;
    });
    setExcluded(current=>{
      const next={...current};
      for(const row of bulkRows)delete next[row.uid];
      return next;
    });
    setNotice('已將此定錨點套用到 '+bulkRows.length.toLocaleString()+' 篇候選文章，尚未寫入資料庫。');
  };
  const writableUids=useMemo(()=>new Set(selectedUpdates.map(row=>row.uid)),[selectedUpdates]);
  const pendingCount=ready.length+(analysis?.disputes?.length||0);
  const unreadyCount=Math.max(0,pendingCount-selectedUpdates.length);
  const reviewPage=Math.min(page,Math.max(0,Math.ceil(reviewGroups.length/10)-1));
  const selectGroup=(group,selected,chosen)=>setExcluded(current=>{
    const next={...current};
    for(const row of group.rows){
      const target=itemChoices[row.uid]||chosen;
      const valid=Boolean(target&&row.candidates.some(candidate=>candidate.uid===target)
        &&(!row.existingPlaceId||row.existingPlaceId===target));
      if(selected&&valid)delete next[row.uid];
      else next[row.uid]=true;
    }
    return next;
  });
  async function apply(){
    if(!analysis||!canWrite||writing||analyzing)return;
    const updates=selectedUpdates;
    if(!window.confirm('確認補寫 '+updates.length+' 篇作品缺少的地點關聯？\\n\\n'
      +'已有 place_id 的文章不會再次寫入；location 不更動。\\n'
      +'Timeline 原始資料不會儲存。'))return;
    setWriting(true);setNotice('');setWriteProgress({done:0,total:updates.length});let completed=0;
    try{
      assertEditorSession(window.sessionStorage);
      const run=runRef.current;
      const deadline=Date.now()+EDIT_OPERATION_TTL_MS;
      for(let i=0;i<updates.length;i+=WRITE_BATCH){
        if(run!==runRef.current)break;
        if(Date.now()>=deadline)throw Error('批次寫入已達 5 分鐘操作期限；請核對已成功寫入筆數。');
        assertEditorSession(window.sessionStorage);
        const batch=updates.slice(i,i+WRITE_BATCH);
        const result=await dbAuthClient.schema('silver').anchor(scopeId,'point',
          {op:'link',mode:'place_id',updates:batch});
        if(run!==runRef.current)break;
        const affected=Number(checked(result,'批次補寫 place_id')?.count||0);
        if(affected!==batch.length)throw Error('資料庫回報的寫入筆數不一致，請重新分析');
        completed+=affected;
        const resolved=new Set(batch.map(row=>row.uid));
        setAnalysis(previous=>previous?{...previous,
          ready:previous.ready.filter(row=>!resolved.has(row.uid)),
          disputes:previous.disputes.filter(row=>!resolved.has(row.uid)),
          unchanged:[...previous.unchanged,...previous.ready.filter(row=>resolved.has(row.uid)),
            ...previous.disputes.filter(row=>resolved.has(row.uid))]}:null);
        setCompletedCount(count=>count+affected);
        setWriteProgress({done:completed,total:updates.length});
        setNotice('已成功寫入 '+completed+' / '+updates.length+' 篇；已從待處理清單移除。');
      }
      await revalidateServerMetadata();
      await Promise.allSettled([
        cache.invalidate({queryKey:['scope-trace',scopeId]}),
        cache.invalidate({queryKey:['trace-current',scopeId]}),
        cache.invalidate({queryKey:['loc-place-summary',scopeId]})
      ]);
      setNotice('寫入完成：'+completed+' 篇。其他未選地點或有歧義的文章仍保留在清單內。');
    }catch(e){
      setNotice('已成功寫入 '+completed+' 篇；其他文章保留在清單內。錯誤：'+friendlyError(e)+'。若資料同時被修改，請重新分析後再提交。');
    }finally{setWriting(false);}
  }
  if(!enabled)return <p className="scope-status">請先選擇個別 Scope，LOC 不執行跨 Scope 的行蹤比對。</p>;
  return <section className="loc-card scope-feature-card" aria-label="Google Timeline 地點整理">
    <h3>地點整理 · Google Timeline</h3>
    <p className="scope-status">Timeline JSON 只在瀏覽器本機背景解析，每次可指定日期區間，最長一年。先使用 date 查出區間內文章，再於瀏覽器比對時間及 500 公尺內既有定錨點，只列出 place_id 尚未填寫的文章；按定錨點集中審查。只補寫 place_id，不改 location，不儲存私人行蹤。</p>
    <div className="scope-management-fields">
      <label>選擇 Google Timeline JSON
        <input ref={fileRef} type="file" accept=".json,application/json" disabled={analyzing||writing}
          onChange={e=>{const file=e.currentTarget.files?.[0]||null;
            runRef.current++;abortWorker();try{clearTimelineReviewSession(sessionStorage,scopeId);}catch{}setSessionEnabled(false);setSessionWarning('');setAnalysis(null);setGroupChoices({});setBulkPlaceId('');setItemChoices({});setExcluded({});setGroupPages({});setProgress(null);setNotice('');setPage(0);setWriteProgress(null);setCompletedCount(0);
            setSelectedFile(file);
          }}/>
      </label>
      <label>開始日期（含當日）
        <input type="date" value={rangeStart} disabled={analyzing||writing} onChange={e=>{setRangeStart(e.target.value);clearTimelineReviewSession(sessionStorage,scopeId);setSessionEnabled(false);setAnalysis(null);}}/>
      </label>
      <label>結束日期（含當日，最多間隔一年）
        <input type="date" value={rangeEnd} disabled={analyzing||writing} onChange={e=>{setRangeEnd(e.target.value);clearTimelineReviewSession(sessionStorage,scopeId);setSessionEnabled(false);setAnalysis(null);}}/>
      </label>
      <p className="scope-status">可比對空間定錨點：{eligible.length.toLocaleString()}；只辨識造訪地點，移動路線不直接視為文章的確定位置。</p>
    </div>
    {anchorQuery.error?<p role="alert" className="scope-status scope-error">讀取定錨點失敗：{friendlyError(anchorQuery.error)}</p>:null}
    <div className="scope-stat-controls">
      <button type="button" className="loc-button" disabled={!selectedFile||!rangeStart||!rangeEnd||analyzing||writing||anchorQuery.isPending||Boolean(anchorQuery.error)}
        onClick={analyze}>{analyzing?'比對中…':'分析 JSON 並預覽'}</button>
      <button type="button" className="loc-button" disabled={writing} onClick={reset}>清除暫存／重新選檔</button>
      {analyzing?<button type="button" className="loc-button" onClick={()=>{
        runRef.current++;abortWorker();
        if(analyzeTimerRef.current!==null)clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current=null;
        setAnalyzing(false);setNotice('已取消分析，尚未寫入任何資料。');
      }}>取消分析</button>:null}
    </div>
    {progress&&analyzing?<p role="status" className="scope-status">{progress.message} {progress.total?progress.done+' / '+progress.total+' 批':''}</p>:null}
    {analysis?<section className="scope-card">
      <h4>Google Timeline · {pendingCount?'尚待確認／寫入':'本次預覽已處理完畢'}</h4>
      <p className="scope-status">Timeline 造訪區間：{analysis.visitCount.toLocaleString()}；
        500 公尺外／無定錨點：{analysis.empty.toLocaleString()}；
        候選有歧義的造訪區間：{analysis.ambiguous.toLocaleString()}。</p>
      <p className="scope-status">待補 place_id 文章：{(ready.length+analysis.disputes.length).toLocaleString()} 篇；
        按定錨點審查群組：{reviewGroups.length.toLocaleString()} 組；
        其中有歧義文章 {analysis.disputes.length.toLocaleString()} 篇。
        已有 place_id 的文章不列入；location 不修改。</p>
      <label className="loc-timeline-review-cache">
        <input type="checkbox" checked={sessionEnabled} disabled={!sessionReady||!sessionOwner||writing}
          onChange={e=>onToggleSessionCache(e.target.checked)}/>
        本分頁暫存審查進度（重新整理免重算；僅本機保存預覽，不保存原始 JSON）
      </label>
      {sessionWarning?<p className="scope-status scope-error" role="alert">{sessionWarning}</p>:null}
      <div className="scope-stat-controls" role="group" aria-label="一次選定空間定錨點">
        <label>一次套用空間定錨點（500 公尺內候選）
          <select className="scope-select" value={bulkPlaceId} disabled={writing}
            onChange={e=>setBulkPlaceId(e.target.value)}>
            <option value="">選擇已建立的空間定錨點</option>
            {eligible.map(place=><option key={place.uid} value={place.uid}>{place.title||place.uid}（{place.uid}）</option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={writing||!bulkRows.length}
          onClick={applyBulkPlace}>
          一次套用 {bulkRows.length.toLocaleString()} 篇候選文章
        </button>
      </div>
      <div className="loc-timeline-review-action" role="region" aria-label="Timeline 批次寫入">
        <div className="loc-timeline-review-action__summary" role="status" aria-live="polite">
          <strong>{writing?'正在寫入資料庫':pendingCount?'分析完成 · 尚未全部寫入':'已處理完成'}</strong>
          <span>可寫入 {selectedUpdates.length.toLocaleString()} 篇 · 未選定或未勾選 {unreadyCount.toLocaleString()} 篇{completedCount?' · 已寫入 '+completedCount.toLocaleString()+' 篇':''}</span>
          {writing&&writeProgress?<progress max={writeProgress.total} value={writeProgress.done} aria-label="文章批次寫入進度"/>:null}
        </div>
        <button type="button" className="loc-button primary" disabled={!canWrite||writing||analyzing}
          onClick={apply}>{writing?'正在寫入…':canWrite?'確認寫入 '+selectedUpdates.length.toLocaleString()+' 篇':'沒有可寫入的文章'}</button>
      </div>
      {reviewGroups.length>0?<details className="loc-timeline-review-groups">
        <summary>檢查或修改地點 · {reviewGroups.length.toLocaleString()} 組（點此展開）</summary>
        <p className="scope-status">同一個定錨點附近的不同 GPS 讀值已合併審查。有歧義時才需要逐篇確認。</p>
        {reviewGroups.slice(reviewPage*10,(reviewPage+1)*10).map(group=>{
          const chosen=groupChoices[group.key]??group.defaultPlaceId;
          const groupPage=groupPages[group.key]||0;
          const writableCount=group.rows.filter(row=>writableUids.has(row.uid)).length;
          return <details key={group.key} className="scope-card">
            <summary>{group.candidates.find(candidate=>candidate.uid===chosen)?.title||group.candidates.find(candidate=>candidate.uid===group.suggestedPlaceId)?.title||'待選地點'} · {group.rows.length.toLocaleString()} 篇 · 可寫入 {writableCount.toLocaleString()} 篇 · {group.key.startsWith('anchor:')?(group.disputed?'定錨點附近 · 待確認':'定錨點附近 · 已自動對應'):'需逐篇確認'}</summary>
            <div className="scope-stat-controls">
              <button type="button" className="loc-button" disabled={writing||!chosen}
                onClick={()=>selectGroup(group,true,chosen)}>全選這組可寫入文章</button>
              <button type="button" className="loc-button" disabled={writing}
                onClick={()=>selectGroup(group,false,chosen)}>取消這組全選</button>
            </div>
            <label>一次指定這組文章的空間定錨點（必要時可逐篇覆蓋）
              <select className="scope-select" disabled={writing} value={chosen}
                onChange={e=>{
                  setGroupChoices(current=>({...current,[group.key]:e.target.value}));
                  setItemChoices(current=>{
                    const next={...current};
                    for(const row of group.rows)delete next[row.uid];
                    return next;
                  });
                }}>
                <option value="">尚未選擇 · 全部暫不寫入</option>
                {group.candidates.map(c=><option key={c.uid} value={c.uid}>{c.title} · 約 {c.meters} 公尺（{c.uid}）</option>)}
              </select>
            </label>
            <div role="group" aria-label="這組文章勾選清單">
              {group.rows.slice(groupPage*50,(groupPage+1)*50).map(row=>{
                const selected=itemChoices[row.uid]||chosen;
                const valid=Boolean(selected&&row.candidates.some(c=>c.uid===selected)&&
                  (!row.existingPlaceId||row.existingPlaceId===selected));
                const status=[row.existingPlaceId?'既有 ID：'+row.existingPlaceId+'（不覆寫）':'',row.reason||'',!valid?'尚未符合寫入條件':''].filter(Boolean);
                return <div key={row.uid} className="loc-timeline-review-row">
                  <label className="loc-timeline-review-row__article">
                    <input type="checkbox" disabled={writing} checked={!excluded[row.uid]}
                      onChange={e=>setExcluded(current=>({...current,[row.uid]:!e.target.checked}))}/>
                    <span className="loc-timeline-review-row__date">{String(row.createtime||'').slice(0,16)||'時間不明'}</span>
                    <span className="loc-timeline-review-row__title" title={row.title||'未命名文章'}>{row.title||'未命名文章'}</span>
                    <span className="loc-timeline-review-row__uid">{row.uid}</span>
                  </label>
                  <select className="scope-select loc-timeline-review-row__place" aria-label={'單篇地點／樓層 · '+row.uid}
                    disabled={writing} value={itemChoices[row.uid]||''}
                    onChange={e=>setItemChoices(current=>({...current,[row.uid]:e.target.value}))}>
                    <option value="">{chosen?'沿用：'+(group.candidates.find(candidate=>candidate.uid===chosen)?.title||chosen):'尚未選擇 · 不寫入'}</option>
                    {row.candidates.map(c=><option key={c.uid} value={c.uid}>{c.title}（{c.uid}）</option>)}
                  </select>
                  {status.length?<span className="loc-timeline-review-row__status" title={status.join('；')}>{!valid?'不可寫入':row.existingPlaceId?'保留原 ID':'需確認'}</span>:null}
                </div>;
              })}
            </div>
            {group.rows.length>50?<div className="scope-stat-controls">
              <button type="button" className="loc-button" disabled={groupPage===0||writing}
                onClick={()=>setGroupPages(current=>({...current,[group.key]:groupPage-1}))}>上一頁</button>
              <span>{groupPage+1} / {Math.ceil(group.rows.length/50)} 頁</span>
              <button type="button" className="loc-button" disabled={(groupPage+1)*50>=group.rows.length||writing}
                onClick={()=>setGroupPages(current=>({...current,[group.key]:groupPage+1}))}>下一頁</button>
            </div>:null}
          </details>;
        })}
        {reviewGroups.length>10?<div className="scope-stat-controls">
          <button type="button" className="loc-button" disabled={reviewPage===0||writing}
            onClick={()=>setPage(reviewPage-1)}>上一組</button>
          <span>群組 {reviewPage+1} / {Math.ceil(reviewGroups.length/10)} 頁</span>
          <button type="button" className="loc-button" disabled={(reviewPage+1)*10>=reviewGroups.length||writing}
            onClick={()=>setPage(reviewPage+1)}>下一組</button>
        </div>:null}
      </details>:null}
    </section>:null}
    {notice?<p role="status" className="scope-status">{notice}</p>:null}
  </section>;
}
