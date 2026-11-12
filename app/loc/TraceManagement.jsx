'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import ScopeOptionPicker from '../modular/ScopeOptionPicker';
import {useEditDockForm} from '../modular/edit-dock';
import {useAsyncResource,useResourceCache} from './use-async-resource';
import {revalidateServerMetadata} from './scope-data';
import {
  TRACE_SCOPES,traceKey,traceAllAnchorsKey,
  readTraceData,addTraceAnchor,updateTraceAnchor,renameTraceAnchorTitles,updateTraceVisibilityBulk,mergeTraceAnchorPoints
} from '../modular/features/trace/trace-data';
import {reviewReorderedCoordinateNames} from '../modular/features/trace/trace-place-names.mjs';
import {selectPointMergeSources} from './trace-point-merge-selection.mjs';
import {
  filterTraceAnchorsByText,addTraceAnchorSelection,removeTraceAnchorSelection
} from './trace-bulk-anchor-filter.mjs';
import {readPlaceSummary} from './place-summary-client';

const BlockNoteEditor=dynamic(()=>import('./BlockNoteEditor'),{loading:()=>null});
const TraceRouteManager=dynamic(()=>import('./TraceRouteManager'),{
  loading:()=> <p className="scope-status" role="status">正在開啟路線／痕跡圖管理…</p>
});
const TraceOrganizer=dynamic(()=>import('./TraceOrganizer'),{
  loading:()=> <p className="scope-status">正在載入地點名稱整理…</p>
});
const TraceMap=dynamic(()=>import('../modular/features/trace/TraceMap'),{
  ssr:false,loading:()=> <p className="scope-status">正在載入地圖…</p>
});

function AnchorEditor({scopeId,spatial,reload}){
  const cache=useResourceCache();
  // Day-level place rows for the "文化河道" stems drawn on the map's own
  // saved anchors (TraceMap filters to titles it already shows).
  const placeSummary=useAsyncResource(['trace-place-summary',scopeId],
    ()=>readPlaceSummary(scopeId,{}),{revalidateOnFocus:false,revalidateOnReconnect:false});
  const ownAnchors=useMemo(()=>(spatial.anchors||[]).filter(row=>row.source_scope===scopeId),
    [spatial.anchors,scopeId]);
  // Reuse the already authorized Point/Path/Trace rows; no suggestion query.
  const suggestionRows=useMemo(()=>[
    ...ownAnchors.map(row=>({...row,type:'point'})),
    ...(spatial.maps||[]).filter(row=>row.source_scope===scopeId)
      .map(row=>({...row,type:row.trace_type}))
  ],[ownAnchors,spatial.maps,scopeId]);
  const [editingUid,setEditingUid]=useState('');
  const [invisible,setInvisible]=useState(false);
  const [bulkUids,setBulkUids]=useState([]);
  const [bulkFilter,setBulkFilter]=useState('');
  const [bulkBusy,setBulkBusy]=useState(false);
  const [pendingRenames,setPendingRenames]=useState({});
  const [pendingVisibility,setPendingVisibility]=useState(null);
  const [standardTitles,setStandardTitles]=useState({});
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [postalAddress,setPostalAddress]=useState('');
  const [longitude,setLongitude]=useState('');
  const [latitude,setLatitude]=useState('');
  const [focusLocation,setFocusLocation]=useState(null);
  const [mapOpen,setMapOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [isError,setIsError]=useState(false);
  const options=useMemo(()=>ownAnchors.map(row=>({value:row.uid,label:row.title+(row.postal_address?' · '+row.postal_address:'')})),[ownAnchors]);
  const renameGroups=useMemo(()=>reviewReorderedCoordinateNames(ownAnchors),[ownAnchors]);
  const filteredBulkAnchors=useMemo(()=>filterTraceAnchorsByText(ownAnchors,bulkFilter),
    [ownAnchors,bulkFilter]);
  const selectedBulkUids=useMemo(()=>new Set(bulkUids),[bulkUids]);
  // The upper selected point is the keeper; every lower checked point is a source.
  // Never allow selecting or deleting the keeper.
  const mergeUids=useMemo(()=>selectPointMergeSources(ownAnchors,editingUid,bulkUids,{
    visibilityPending:Boolean(pendingVisibility)
  }),[editingUid,bulkUids,ownAnchors,pendingVisibility]);
  const editingRow=useMemo(()=>ownAnchors.find(row=>row.uid===editingUid),[ownAnchors,editingUid]);
  const formDirty=editingUid?Boolean(editingRow&&(
    title!==String(editingRow.title||'')||
    description!==String(editingRow.description||'')||
    postalAddress!==String(editingRow.postal_address||'')||
    invisible!==Boolean(editingRow.invisible)||
    longitude!==(editingRow.longitude==null?'':String(editingRow.longitude))||
    latitude!==(editingRow.latitude==null?'':String(editingRow.latitude))
  )):Boolean(title||description||postalAddress||longitude||latitude);
  const dirty=formDirty||Object.keys(pendingRenames).length>0||Boolean(pendingVisibility)||mergeUids.length>0;
  const pickExisting=uid=>{
    if(busy||bulkBusy)return false;
    if(uid===editingUid)return true;
    const row=ownAnchors.find(item=>item.uid===uid);
    if(uid&&!row)return false;
    if(dirty&&!window.confirm('目前有尚未儲存的地點修改或批次操作，確定放棄並切換？'))
      return false;
    setEditingUid(row?.uid||'');
    setPendingRenames({});
    setStandardTitles({});
    setIsError(false);setNotice('');
    // Switching primary starts a new merge selection. Never silently
    // merge source checkboxes carried over from a previous primary.
    setBulkUids([]);
    setPendingVisibility(null);
    setTitle(row?.title||'');
    setDescription(row?.description||'');
    setPostalAddress(row?.postal_address||'');
    setInvisible(Boolean(row?.invisible));
    setLongitude(row?.longitude==null?'':String(row.longitude));
    setLatitude(row?.latitude==null?'':String(row.latitude));
    setFocusLocation(row?.longitude!=null&&row?.latitude!=null
      ?{longitude:row.longitude,latitude:row.latitude,name:row.title}:null);
    return true;
  };
  const save=async({switching=false}={})=>{
    if(scopeId==='loc'){
      setIsError(true);setNotice('LOC 空間聚合已暫停；請先在來源 Scope 編輯。');return false;
    }
    if(busy||bulkBusy)return false;
    if(!dirty){setIsError(true);setNotice('目前沒有待儲存的地點變更。');return false;}
    const visibility=pendingVisibility;
    const sources=[...mergeUids];
    if(sources.length>100){
      setIsError(true);setNotice('一次最多合併 100 個來源地點。');return false;
    }
    // The Save-and-switch dialog already confirms this destructive operation.
    // Never stack a native window.confirm behind an open modal dialog.
    if(sources.length&&!switching&&!window.confirm('確定將 '+sources.length+' 筆地點合併到「'+title+
      '」（UID '+editingUid+'）？來源 UID 會刪除，但其文章與路線關聯將轉到主要 UID。'))return false;
    if(visibility&&!switching&&!window.confirm('確定將 '+visibility.uids.length+' 個空間定錨點設定為'+
      (visibility.invisible?'隱藏':'公開')+'？'))return false;
    setBusy(true);setIsError(false);setNotice('');
    let savedUid='';
    try{
      // Apply queued title updates before the main editor so the explicitly
      // chosen primary title always wins when both touch the same anchor.
      let renamed=0,visibilityCount=0,mergedCount=0;
      for(const [key,task] of Object.entries(pendingRenames)){
        for(let i=0;i<task.uids.length;i+=100)
          renamed+=await renameTraceAnchorTitles({
            scopeId,uids:task.uids.slice(i,i+100),title:task.title
          });
        setPendingRenames(current=>{
          const next={...current};delete next[key];return next;
        });
      }
      if(formDirty){
        if(!title.trim())throw Error('請填入空間定錨點標題');
        const input={scopeId,title,description,address:postalAddress,longitude,latitude,invisible};
        const saved=editingUid
          ?await updateTraceAnchor({...input,uid:editingUid})
          :await addTraceAnchor(input);
        savedUid=saved.uid;
      }
      // The server owns the entire UID rewrite/deletion transaction. Never
      // delete selected rows in the browser or assume a title rename is a merge.
      if(sources.length){
        mergedCount=await mergeTraceAnchorPoints({
          scopeId,keepUid:editingUid,removeUids:sources
        });
        setBulkUids(ids=>ids.filter(uid=>!sources.includes(uid)));
      }
      if(visibility){
        for(let i=0;i<visibility.uids.length;i+=200)
          visibilityCount+=await updateTraceVisibilityBulk({
            scopeId,uids:visibility.uids.slice(i,i+200),invisible:visibility.invisible
          });
        setPendingVisibility(null);setBulkUids([]);
      }
      // reload() already revalidates the mounted, authenticated Trace query.
      // Invalidating that very key again would erase the fresh result and
      // expose an empty anchor list on the next edit without another fetch.
      let refreshFailed=false;
      try{
        const refreshed=await reload();
        if(!Array.isArray(refreshed?.anchors))refreshFailed=true;
        else if(editingUid||savedUid){
          const current=refreshed.anchors.find(row=>row.uid===(editingUid||savedUid));
          if(current){
            setEditingUid(current.uid);
            setTitle(current.title||'');
            setDescription(current.description||'');
            setPostalAddress(current.postal_address||'');
            setInvisible(Boolean(current.invisible));
            setLongitude(current.longitude==null?'':String(current.longitude));
            setLatitude(current.latitude==null?'':String(current.latitude));
          }
        }
      }catch{refreshFailed=true;}
      try{await revalidateServerMetadata();}catch{refreshFailed=true;}
      await Promise.allSettled([
        cache.invalidate({queryKey:traceAllAnchorsKey(scopeId)}),
        cache.invalidate({queryKey:['trace-map-index',scopeId]}),
        cache.invalidate({queryKey:['trace-current',scopeId]})
      ]);
      // Keep the upper primary selection after a successful merge. The
      // reloaded list refreshes its title and UID, while removed sources vanish.
      setNotice([
        mergedCount?'已合併 '+mergedCount+' 筆地點至主要 UID '+editingUid:'',
        savedUid?'定錨點 '+savedUid+' 已保存':'',
        renamed?'已統一 '+renamed+' 筆地點名稱':'',
        visibilityCount?'已更新 '+visibilityCount+' 個可見性設定':''
      ].filter(Boolean).join('；')+'。'+
        (refreshFailed?'重新讀取未完成，請勿重複提交。':''));
      return true;
    }catch(e){
      // The edit dock owns the visible Save/Save-and-switch result. Returning
      // false hides the actual RPC/permission/validation failure behind a
      // generic warning and traps the user in its open switch dialog.
      const message=String(e?.message||e||'空間定錨儲存失敗');
      setIsError(true);
      setNotice(message);
      throw new Error(message,{cause:e});
    }
    finally{setBusy(false);}
  };
  const quickRename=group=>{
    if(busy||bulkBusy||scopeId==='loc')return;
    const canonicalTitle=standardTitles[group.key]||group.items[0]?.title||'';
    const change=group.items.filter(item=>item.title!==canonicalTitle);
    if(!change.length){setIsError(false);setNotice('這組地點名稱已相同，不需更新。');return;}
    setPendingRenames(current=>({...current,[group.key]:{
      uids:change.map(item=>item.uid),title:canonicalTitle
    }}));
    setIsError(false);setNotice('已將 '+change.length+' 筆名稱變更加入待儲存清單；按底部「儲存」才會寫入。');
  };
  const bulkApply=invisible=>{
    if(bulkBusy||busy||!bulkUids.length||scopeId==='loc')return;
    setPendingVisibility({uids:[...bulkUids].filter(uid=>uid!==editingUid),invisible});
    setIsError(false);setNotice('已將 '+bulkUids.length+' 個定錨點的'+
      (invisible?'隱藏':'公開')+'設定加入待儲存清單；按底部「儲存」才會寫入。');
  };
  useEditDockForm({save,isDirty:()=>dirty,isBusy:()=>busy||bulkBusy,
    isDestructive:()=>mergeUids.length>0||Boolean(pendingVisibility)});
  return <section className="loc-card scope-feature-card loc-trace-anchor-editor">
    <h3>{editingUid?'編輯空間定錨點':'新增空間定錨點'}</h3>
    <label>編輯既有地點（直接搜尋標題）
      <ScopeOptionPicker id={'trace-anchor-edit-'+scopeId} options={options}
        value={editingUid} onChange={pickExisting} disabled={busy||bulkBusy} resetKey={scopeId}
        placeholder="搜尋標題，或留空新增"/>
    </label>
    <details className="scope-card loc-trace-quick-update">
      <summary>快速更新｜相同位置、名稱排列不同（{renameGroups.length} 組）</summary>
      {!renameGroups.length?<p className="scope-status">目前沒有符合條件的名稱排列候選；沒有座標的地點不會猜測為同一位置。</p>:null}
      {renameGroups.slice(0,80).map(group=>{
        const names=[...new Set(group.items.map(item=>item.title))];
        const selected=standardTitles[group.key]||group.items[0].title;
        const updateCount=group.items.filter(item=>item.title!==selected).length;
        return <div key={group.key} className="loc-trace-quick-update-group">
          <p><strong>相同座標：</strong>{group.position.join(', ')} · {group.items.length} 筆</p>
          <p className="scope-status">{group.items.map(item=>item.title+'（'+item.uid+'）').join('、')}</p>
          <label>選擇統一名稱
            <select value={selected} onChange={event=>setStandardTitles(current=>({
              ...current,[group.key]:event.target.value
            }))} disabled={busy}>
              {names.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="loc-button primary" disabled={busy||!updateCount||scopeId==='loc'}
            onClick={()=>quickRename(group)}>{pendingRenames[group.key]?'已加入待儲存':'選取 '+updateCount+' 筆名稱變更'}</button>
        </div>;
      })}
      {renameGroups.length>80?<p className="scope-status">目前顯示前 80 組，整理後會載入下一批。</p>:null}
    </details>
    <details className="scope-card">
      <summary>大量設定空間定錨點（已選 {bulkUids.length} 筆）</summary>
      <label>以文字篩選空間定錨點（標題、地址、說明、UID）
        <input type="search" value={bulkFilter} disabled={busy||bulkBusy}
          onChange={event=>setBulkFilter(event.target.value)}
          placeholder="輸入相關文字，例如：板橋"/>
      </label>
      {editingUid?<p className="scope-status" role="status">
        主要地點 UID：<strong>{editingUid}</strong>。下方勾選來源地點後，
        按固定功能列的「儲存」即合併並更新所有關聯。
        {mergeUids.length?' 待合併 '+mergeUids.length+' 筆。':''}
        {pendingVisibility?'目前已選擇大量可見性操作，本次儲存不會合併地點。':''}
      </p>:<p className="scope-status">要合併地點，先在上方選擇主要地點，再勾選下方來源。</p>}
      <p className="scope-status" role="status">
        符合 {filteredBulkAnchors.length} 筆／全部 {ownAnchors.length} 筆；已勾選 {bulkUids.length} 筆。切換文字篩選不會取消先前的勾選。
      </p>
      <div className="scope-stat-controls">
        <button type="button" className="loc-button"
          disabled={busy||bulkBusy||!bulkFilter.trim()||!filteredBulkAnchors.length}
          onClick={()=>setBulkUids(ids=>addTraceAnchorSelection(ids,filteredBulkAnchors.filter(row=>row.uid!==editingUid)))}>勾選全部符合結果</button>
        <button type="button" className="loc-button"
          disabled={busy||bulkBusy||!bulkFilter.trim()||!filteredBulkAnchors.length}
          onClick={()=>setBulkUids(ids=>removeTraceAnchorSelection(ids,filteredBulkAnchors))}>取消符合結果勾選</button>
        <button type="button" className="loc-button" disabled={busy||bulkBusy}
          onClick={()=>setBulkUids(ownAnchors.filter(row=>row.uid!==editingUid).map(row=>row.uid))}>全選所有定錨點（不限篩選）</button>
        <button type="button" className="loc-button" disabled={busy||bulkBusy}
          onClick={()=>{setBulkUids([]);setPendingVisibility(null);}}>清除全部勾選</button>
        <button type="button" className="loc-button" disabled={busy||bulkBusy||!bulkUids.length}
          onClick={()=>bulkApply(true)}>大量隱藏</button>
        <button type="button" className="loc-button" disabled={busy||bulkBusy||!bulkUids.length}
          onClick={()=>bulkApply(false)}>大量公開</button>
      </div>
      <div style={{maxHeight:'16rem',overflow:'auto'}}>
        {filteredBulkAnchors.map(row=><label key={row.uid} style={{display:'block'}}>
          <input type="checkbox" disabled={busy||bulkBusy||row.uid===editingUid} checked={row.uid!==editingUid&&selectedBulkUids.has(row.uid)}
            onChange={e=>setBulkUids(ids=>e.target.checked?[...ids.filter(uid=>uid!==row.uid),row.uid]:ids.filter(uid=>uid!==row.uid))}/>
          {row.title} · {row.uid}{row.uid===editingUid?'（主要地點，不可合併）':''}
        </label>)}
        {!filteredBulkAnchors.length?<p className="scope-status">沒有符合文字的定錨點。</p>:null}
      </div>
      {pendingVisibility?<p className="scope-status">待儲存：{pendingVisibility.uids.length} 個地點將設定為{pendingVisibility.invisible?'隱藏':'公開'}。</p>:null}
    </details>
    <div className="scope-management-fields">
      <label>地點標題<input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}
        disabled={busy} placeholder="空間定錨點名稱"/></label>
      <label>文字地址（非必填）<input maxLength={320} value={postalAddress}
        onChange={e=>setPostalAddress(e.target.value)} disabled={busy}/></label>
      <label>可見性
        <select className="scope-select" value={Number(invisible)} onChange={e=>setInvisible(e.target.value==='1')} disabled={busy}>
          <option value={0}>顯示</option><option value={1}>隱藏</option>
        </select>
      </label>
      <div className="loc-trace-description-field"><span>說明</span>
        <BlockNoteEditor editorKey={'point-note:'+scopeId+':'+(editingUid||'new')}
          content={description} editable={!busy} plainTextOnly canInsertImage={false}
          suggestionKind="spatial" suggestions={suggestionRows}
          onPlainTextChange={setDescription}/>
      </div>
      <label>經度（可留空）<input type="number" min={-180} max={180} step="any"
        value={longitude} onChange={e=>setLongitude(e.target.value)} disabled={busy}/></label>
      <label>緯度（可留空）<input type="number" min={-90} max={90} step="any"
        value={latitude} onChange={e=>setLatitude(e.target.value)} disabled={busy}/></label>
      <p className="scope-status">新增、修改、統一名稱、合併已勾選來源與大量可見性設定，使用固定功能列「儲存」；「放棄」不會刪除地點。</p>
    </div>
    {notice?<p role={isError?'alert':'status'} className={'scope-status'+(isError?' scope-error':'')}>{notice}</p>:null}
    <button className="loc-button" type="button" aria-expanded={mapOpen}
      onClick={()=>setMapOpen(open=>!open)}>{mapOpen?'關閉座標地圖':'開啟座標地圖'}</button>
    {mapOpen?<TraceMap spatialData={spatial} placeDayRows={placeSummary.data?.rows||[]} focusLocation={focusLocation}
      onLocationPick={({lng,lat,name})=>{
        if(name)setTitle(t=>t.trim()||name);
        setLongitude(String(Math.round(lng*1e6)/1e6));
        setLatitude(String(Math.round(lat*1e6)/1e6));
      }}/>:null}
  </section>;
}

// Embedded under the existing /manage (Scope) or /admin (LOC) routes.
// The parent manager owns authorization, edit mode and tab navigation.
export default function TraceManagementPanel({scopeId,mode='anchor',routeMode='all'}){
  const enabled=TRACE_SCOPES.includes(scopeId);
  const query=useAsyncResource(traceKey(scopeId,{includeHidden:true}),()=>readTraceData(scopeId,{includeHidden:true}),{
    enabled:enabled&&mode!=='map',revalidateOnFocus:false,revalidateOnReconnect:false
  });
  if(!enabled)return <p className="scope-status">此 Scope 尚未配置痕跡資料表。</p>;
  if(mode==='map')return <TraceRouteManager key={scopeId+'-'+routeMode} scopeId={scopeId} mode={routeMode}/>;
  if(query.error)return <p role="alert" className="scope-status scope-error">{String(query.error.message||query.error)}</p>;
  if(query.isPending||query.data===undefined)
    return <p className="scope-status" role="status">正在載入空間定錨點…</p>;
  const spatial=query.data;
  return mode==='cleanup'
    ?<TraceOrganizer key={scopeId+'-cleanup'} scopeId={scopeId} spatial={spatial} reload={()=>query.mutate()}/>
    :<AnchorEditor key={scopeId+'-anchor'} scopeId={scopeId} spatial={spatial} reload={()=>query.mutate()}/>;
}
