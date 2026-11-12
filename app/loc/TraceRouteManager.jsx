'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import ScopeOptionPicker from '../modular/ScopeOptionPicker';
import {planTraceVisibilityUids} from './trace-visibility-plan.mjs';
import {indexZModelAnchorHierarchy} from '../../zenstack/anchor-hierarchy.mjs';
import {useSearchParams} from 'next/navigation';
import {useAccount} from './use-account';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';
import {useAsyncResource,useResourceCache} from './use-async-resource';
import {
  TRACE_SCOPES,traceMapIndexKey,traceCurrentKey,traceAllAnchorsKey,
  traceMemberUids,readTraceMapIndex,readCurrentTraceAnchors,readAllTraceAnchors,
  addTraceMap,updateTraceMap,deleteTraceMap,updateTraceVisibilityBulk
} from '../modular/features/trace/trace-data';
import {
  readDefaultTraceRoute,setDefaultTraceRoute,clearDefaultTraceRoute,chooseDefaultTraceRoute
} from '../modular/features/trace/trace-route-preference.mjs';

const BlockNoteEditor=dynamic(()=>import('./BlockNoteEditor'),{loading:()=>null});
const TraceMap=dynamic(()=>import('../modular/features/trace/TraceMap'),{
  ssr:false,loading:()=> <p className="scope-status">正在載入地圖…</p>
});
const TRACE_SOURCE_ROWS=SCOPE_ROUTE_INDEX.filter(row=>row.active&&TRACE_SCOPES.includes(row.scope_id)&&row.scope_id!=='loc');
const MAX_ROAD=80,MAX_LINES=400;
const unique=items=>[...new Set(items)];
const validPair=pair=>Array.isArray(pair)&&pair.length===2&&pair[0]&&pair[1]&&pair[0]!==pair[1];

export default function TraceRouteManager({scopeId,mode='all'}){
  const account=useAccount(),cache=useResourceCache(),params=useSearchParams();
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId===scopeId);
  const [owner,setOwner]=useState(scopeId==='loc'?(TRACE_SOURCE_ROWS[0]?.scope_id||''):scopeId);
  const [selectedUid,setSelectedUid]=useState('');
  const [editorOpen,setEditorOpen]=useState(false);
  const [editingUid,setEditingUid]=useState('');
  const [type,setType]=useState('path');
  const [invisible,setInvisible]=useState(false);
  const [routeUids,setRouteUids]=useState([]);
  const [bulkSelected,setBulkSelected]=useState([]);
  const [bulkVisibilityMode,setBulkVisibilityMode]=useState('routes');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [filter,setFilter]=useState('');
  const [spool,setSpool]=useState([]);
  const [queue,setQueue]=useState([]);
  const [pairs,setPairs]=useState([]);
  const [selectedAnchor,setSelectedAnchor]=useState(null);
  const [selectedStop,setSelectedStop]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [mapStart,setMapStart]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState(false);
  const [showMap,setShowMap]=useState(false);
  const [savedReceipt,setSavedReceipt]=useState(null);
  const openedFromUrl=useRef('');
  const own=owner!=='loc'&&account.canManageScopeSync(owner);
  // A LOC Group manager can inspect member maps, but edits still require
  // permission on the actual owner Scope.
  const canRead=own||(scopeId==='loc'&&account.canManageGroupSync('loc'));
  const index=useAsyncResource({
    queryKey:traceMapIndexKey(owner,{includeHidden:own}),
    enabled:TRACE_SCOPES.includes(owner)&&canRead,
    queryFn:()=>readTraceMapIndex(owner,{includeHidden:own}),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const records=(index.data||[]).filter(row=>row.source_scope===owner);
  // Resolve Trace -> Path edges with the existing Space ZModel over the
  // already-loaded owner Scope. Four-character legacy IDs stay compatible.
  const spaceGraph=useMemo(()=>{
    const mapped=(index.data||[]).filter(row=>row.source_scope===owner);
    if(!mapped.length||mapped.some(row=>!/^[A-Za-z0-9]{8}$/.test(row.uid)))return null;
    try{
      return indexZModelAnchorHierarchy(mapped.map(row=>({
        uid:row.uid,type:row.trace_type,title:row.title,
        attr:{
          point:[...new Set(traceMemberUids(row))],
          path:row.trace_type==='trace'?[...new Set(row.route_list?.routes||[])]:[]
        }
      })),{family:'space'});
    }catch{return null;}
  },[index.data,owner]);
  const recordByUid=useMemo(()=>new Map(
    (index.data||[]).filter(row=>row.source_scope===owner).map(row=>[row.uid,row])
  ),[index.data,owner]);
  const typedRecords=records.filter(row=>mode==='all'||row.trace_type===mode);
  const visibleRecords=typedRecords.filter(row=>row.title.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const current=typedRecords.find(row=>row.uid===selectedUid)
    ||chooseDefaultTraceRoute(typedRecords,owner,readDefaultTraceRoute(owner));
  const currentRouteMembers=current?.trace_type==='trace'
    ?spaceGraph
      ?spaceGraph.childrenOf(current.uid).map(uid=>recordByUid.get(uid))
        .filter(row=>row?.trace_type==='path')
      :records.filter(row=>row.trace_type==='path'&&(current.route_list?.routes||[]).includes(row.uid))
    :[];
  const currentMemberUids=current
    ?[...new Set([...traceMemberUids(current),...currentRouteMembers.flatMap(traceMemberUids)])]
    :[];
  const anchorIndex=useAsyncResource({
    queryKey:traceAllAnchorsKey(owner,{nativeOnly:owner==='loc',includeHidden:own}),
    enabled:editorOpen,
    queryFn:()=>readAllTraceAnchors(owner,{nativeOnly:owner==='loc',includeHidden:own}),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const currentAnchors=useAsyncResource({
    queryKey:current?traceCurrentKey(owner,{...current,anchor_list:currentMemberUids},{nativeOnly:owner==='loc',includeHidden:own}):null,
    enabled:Boolean(current)&&!editorOpen,
    queryFn:()=>readCurrentTraceAnchors(owner,currentMemberUids,{nativeOnly:owner==='loc',includeHidden:own}),
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const allAnchors=anchorIndex.data||[];
  const suggestionRows=useMemo(()=>[
    ...(anchorIndex.data||[]).map(row=>({...row,type:'point'})),
    ...(index.data||[]).filter(row=>row.source_scope===owner)
      .map(row=>({...row,type:row.trace_type}))
  ],[anchorIndex.data,index.data,owner]);
  const anchorMap=useMemo(()=>new Map(allAnchors.map(a=>[a.uid,a])),[allAnchors]);
  const options=useMemo(()=>allAnchors.map(row=>({value:row.uid,label:row.title+(row.postal_address?' · '+row.postal_address:'')})),[allAnchors]);
  const poolOptions=useMemo(()=>spool.map(uid=>anchorMap.get(uid))
    .filter(Boolean).map(row=>({value:row.uid,label:row.title+(row.postal_address?' · '+row.postal_address:'')})),[spool,anchorMap]);
  const availableRoadOptions=poolOptions.filter(item=>!queue.includes(item.value));
  const incomplete=editorOpen&&Boolean(editingUid||title||description||spool.length||queue.length||pairs.length||routeUids.length||invisible);
  const chosenIds=type==='path'?queue:unique(pairs.flat());
  const preview=editorOpen
    ?(chosenIds.length>=2||type==='trace'&&routeUids.length>0
      ?{uid:editingUid||'EDIT',trace_type:type,source_scope:owner,
        title:title||'地圖預覽',anchor_list:type==='path'?queue:unique(pairs.flat()),route_list:{routes:routeUids,segments:type==='trace'?pairs:[]}}
      :null)
    :current;
  const previewAnchors=currentAnchors.data||[];
  const clear=()=>{
    setEditingUid('');setTitle('');setDescription('');setSpool([]);setQueue([]);setPairs([]);
    setFrom('');setTo('');setMapStart('');setSelectedStop('');setSelectedAnchor(null);setSavedReceipt(null);
    setInvisible(false);setRouteUids([]);
  };
  const allowLeave=()=>!incomplete||window.confirm('尚未儲存，確定放棄修改？');
  const openNew=kind=>{
    if(busy||!allowLeave())return;
    clear();setType(kind);setEditorOpen(true);setShowMap(true);setError(false);setNotice('');
  };
  const openEdit=row=>{
    if(busy||!allowLeave())return;
    clear();setEditorOpen(true);setEditingUid(row.uid);setType(row.trace_type);
    setTitle(row.title);setDescription(row.description||'');
    setInvisible(Boolean(row.invisible));setRouteUids(row.route_list?.routes||[]);
    setQueue(row.trace_type==='path'?[...row.anchor_list]:[]);
    setPairs(row.trace_type==='trace'?(row.route_list?.segments||[]).map(pair=>[...pair]):[]);
    setSpool(traceMemberUids(row));setSelectedUid(row.uid);setShowMap(true);
  };
  useEffect(()=>{
    setSelectedUid('');setEditorOpen(false);setShowMap(false);clear();
  },[owner]);
  useEffect(()=>{
    const requested=params?.get('frame')||'';
    if(!requested||!index.data||!own||editorOpen)return;
    const token=owner+':'+requested;
    if(openedFromUrl.current===token)return;
    const row=records.find(item=>item.uid===requested);
    if(row&&(mode==='all'||row.trace_type===mode)){openedFromUrl.current=token;openEdit(row);}
  },[params,index.data,owner,own]);
  const addToSpool=()=>{
    const uid=selectedAnchor?.value;
    if(!uid||!anchorMap.has(uid)||spool.includes(uid))return;
    setSpool(items=>[...items,uid]);setSelectedAnchor(null);
  };
  const removeFromSpool=uid=>{
    setSpool(items=>items.filter(id=>id!==uid));
    setQueue(items=>items.filter(id=>id!==uid));
    setPairs(items=>items.filter(pair=>!pair.includes(uid)));
    if(from===uid)setFrom('');if(to===uid)setTo('');
  };
  const addRoadStop=()=>{
    if(!selectedStop||!availableRoadOptions.some(option=>option.value===selectedStop)||
      queue.includes(selectedStop)||queue.length>=MAX_ROAD)return;
    setQueue(items=>[...items,selectedStop]);setSelectedStop('');
  };
  const shift=(index,step)=>{
    setQueue(items=>{
      const target=index+step;if(target<0||target>=items.length)return items;
      const next=[...items];[next[index],next[target]]=[next[target],next[index]];return next;
    });
  };
  const addPair=()=>{
    if(!from||!to||from===to||pairs.length>=MAX_LINES)return;
    if(pairs.some(pair=>pair[0]===from&&pair[1]===to))return;
    setPairs(items=>[...items,[from,to]]);setFrom('');setTo('');
  };
  const addMapSelectedAnchor=anchor=>{
    const uid=String(anchor?.uid||'');
    if(busy||!own||!editorOpen||!anchorMap.has(uid))return;
    setSpool(items=>items.includes(uid)?items:[...items,uid]);
    if(type==='path'){
      setQueue(items=>items.includes(uid)||items.length>=MAX_ROAD?items:[...items,uid]);
    }else if(!mapStart){
      setMapStart(uid);
    }else if(uid!==mapStart){
      setPairs(items=>items.length>=MAX_LINES||items.some(pair=>pair[0]===mapStart&&pair[1]===uid)
        ?items:[...items,[mapStart,uid]]);
      setMapStart('');
    }
  };
  const refresh=async()=>{
    await Promise.allSettled([cache.invalidate({queryKey:traceMapIndexKey(owner)}),
      cache.invalidate({queryKey:traceMapIndexKey('loc')}),
      cache.invalidate({queryKey:['trace-current',owner]})]);
  };
  const save=async event=>{
    event?.preventDefault?.();
    if(busy||!own||!editorOpen)return false;
    setBusy(true);setNotice('');setError(false);
    try{
      if(!title.trim())throw Error('請輸入名稱');
      if(type==='path'&&(queue.length<2||queue.length>MAX_ROAD))
        throw Error('路線至少兩站，依先後順序建立');
      if(type==='trace'&&(!(pairs.length||routeUids.length)||pairs.length>MAX_LINES||pairs.some(pair=>!validPair(pair))))
        throw Error('痕跡圖必須至少有一條有效的起點與終點線段');
      if(chosenIds.some(uid=>!anchorMap.has(uid)))throw Error('候選地點中有尚未載入的地點');
      const input={scopeId:owner,type,title,description,invisible,routeUids:type==='trace'?routeUids:[],
        anchorUids:type==='path'?queue:pairs,anchors:allAnchors};
      let receipt=savedReceipt;
      if(receipt&&(receipt.type!==type||receipt.editingUid!==editingUid))
        throw Error('上一筆儲存尚未確認，不會再次新增');
      if(!receipt){
        const row=editingUid
          ?await updateTraceMap({...input,uid:editingUid}):await addTraceMap(input);
        if(!row?.uid)throw Error('資料庫沒有回傳 UID');
        receipt={uid:row.uid,type,editingUid};setSavedReceipt(receipt);
      }
      const updated=await index.mutate();
      const saved=(updated||[]).find(row=>row.uid===receipt.uid&&row.source_scope===owner);
      if(!saved||saved.title!==title.trim()||saved.trace_type!==type
        ||JSON.stringify(saved.anchor_list)!==JSON.stringify(type==='path'?input.anchorUids:unique(input.anchorUids.flat()))
        ||Boolean(saved.invisible)!==invisible
        ||JSON.stringify(saved.route_list?.routes||[])!==JSON.stringify(input.routeUids)
        ||JSON.stringify(saved.route_list?.segments||[])!==JSON.stringify(type==='trace'?input.anchorUids:[]))
        throw Error('資料庫已回應寫入，但重讀尚未一致；保留草稿，按儲存只重新檢查');
      const uid=receipt.uid;
      clear();setSelectedUid(uid);setEditorOpen(false);setShowMap(true);
      await refresh();
      setNotice('已儲存並重讀確認：'+(type==='path'?'路線圖':'痕跡圖'));
      return true;
    }catch(e){setError(true);setNotice(String(e.message||e));return false;}
    finally{setBusy(false);}
  };
  const remove=async row=>{
    if(!own||busy||!window.confirm('刪除「'+row.title+'」？地點與相關作品不會刪除。'))return;
    setBusy(true);setError(false);
    try{
      await deleteTraceMap({scopeId:owner,uid:row.uid,type:row.trace_type});
      await index.mutate();
      setBulkSelected(ids=>ids.filter(id=>id!==row.uid));
      if(selectedUid===row.uid)setSelectedUid('');
      if(readDefaultTraceRoute(owner)===row.uid)clearDefaultTraceRoute(owner,row.uid);
      await refresh();setNotice('已刪除連線資料，原始地點保留');
    }catch(e){setError(true);setNotice(String(e.message||e));}finally{setBusy(false);}
  };
  const applyBulkVisibility=async invisible=>{
    if(busy||!own||!bulkSelected.length)return;
    try{
      const uids=planTraceVisibilityUids({maps:records,selectedUids:bulkSelected,mode:bulkVisibilityMode});
      if(!window.confirm('確定將 '+uids.length+' 筆空間紀錄設定為'+(invisible?'隱藏':'顯示')+'？'+
        (bulkVisibilityMode==='self'?'只變更所選項目。':'將同步變更本次選定的關聯項目。')))return;
      setBusy(true);setError(false);setNotice('');
      let count=0;
      for(let i=0;i<uids.length;i+=200)
        count+=await updateTraceVisibilityBulk({scopeId:owner,uids:uids.slice(i,i+200),invisible});
      setBulkSelected([]);await index.mutate();await refresh();
      setNotice('已更新 '+count+' 筆空間顯示設定。');
    }catch(e){setError(true);setNotice(String(e.message||e));}
    finally{setBusy(false);}
  };
  useEditDockForm({save,isDirty:()=>incomplete,isBusy:()=>busy});
  return <section className="loc-card scope-feature-card loc-trace-map-manager" aria-label="路線與痕跡圖管理">
    <header className="loc-trace-map-manager-heading">
      <div><h3>{mode==='path'?'路線管理':mode==='trace'?'痕跡管理':'路線圖／痕跡圖管理'}</h3>
      </div>
      <div className="scope-stat-controls">
        {mode!=='trace'?<button type="button" className="loc-button" disabled={busy||!own} onClick={()=>openNew('path')}>新增路線圖</button>:null}
        {mode!=='path'?<button type="button" className="loc-button" disabled={busy||!own} onClick={()=>openNew('trace')}>新增痕跡圖</button>:null}
      </div>
    </header>
    {scopeId==='loc'?<label>作品範圍
      <select className="scope-select" value={owner} onChange={e=>{if(allowLeave())setOwner(e.target.value);}}>
        {TRACE_SOURCE_ROWS.map(row=><option key={row.scope_id} value={row.scope_id}>{row.config?.display_name||row.scope_id}</option>)}
      </select>
    </label>:null}
    <label>搜尋已儲存的路線／痕跡圖
      <input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="依標題搜尋"/>
    </label>
    {index.isPending?<p className="scope-status">載入列表中…</p>:null}
    {index.error?<p role="alert" className="scope-status scope-error">{String(index.error.message||index.error)}</p>:null}
    <details className="scope-card"><summary>大量隱藏／公開路線圖與痕跡圖</summary>
      <p className="scope-status">可只更新所選紀錄，或在這次批次操作中連動所屬路線圖與定錨點；每筆只保存自己的顯示狀態。</p>
      <div className="scope-stat-controls">
        <button type="button" className="loc-button" disabled={busy||!own} onClick={()=>setBulkSelected(visibleRecords.map(row=>row.uid))}>全選目前列表</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>setBulkSelected([])}>清除勾選</button>
        <label>連動範圍
          <select className="scope-select" aria-label="批次顯示連動範圍" value={bulkVisibilityMode}
            onChange={event=>setBulkVisibilityMode(event.target.value)} disabled={busy}>
            <option value="self">只處理所選項目</option>
            <option value="routes">連動所屬路線圖</option>
            <option value="all">連動路線圖及定錨點</option>
          </select>
        </label>
        <button className="loc-button" type="button" disabled={busy||!own||!bulkSelected.length} onClick={()=>applyBulkVisibility(true)}>大量隱藏</button>
        <button className="loc-button" type="button" disabled={busy||!own||!bulkSelected.length} onClick={()=>applyBulkVisibility(false)}>大量公開</button>
      </div>
    </details>
    <div className="loc-trace-saved-maps">
      {visibleRecords.map(row=><div className="loc-trace-saved-map" key={row.uid}>
        <label className="scope-status"><input type="checkbox" disabled={busy||!own}
          checked={bulkSelected.includes(row.uid)}
          onChange={e=>setBulkSelected(ids=>e.target.checked?[...ids.filter(id=>id!==row.uid),row.uid]:ids.filter(id=>id!==row.uid))}/>
          勾選</label>
        <button type="button" className="loc-trace-saved-map-summary"
          onClick={()=>{if(allowLeave()){setSelectedUid(row.uid);setShowMap(true);setEditorOpen(false);clear();}}}>
          <span>{row.title}{Boolean(row.invisible)?'（已設定隱藏）':''}</span>
          <span className="scope-status">{row.trace_type==='path'?'路線 · '+row.anchor_list.length+' 站':'痕跡 · '+(row.route_list?.segments?.length||0)+' 段'}</span>
        </button>
        {current?.uid===row.uid?<div className="scope-stat-controls">
          <button type="button" className="loc-button" disabled={!own||busy} onClick={()=>openEdit(row)}>編輯</button>
          <button type="button" className="loc-button" onClick={()=>setShowMap(v=>!v)}>{showMap?'收起':'查看'}地圖</button>
          <button type="button" className="loc-button" onClick={()=>{
            if(setDefaultTraceRoute(owner,row.uid))setNotice('已設為預設顯示');}}>設為預設</button>
          <button type="button" className="loc-button" disabled={!own||busy} onClick={()=>remove(row)}>刪除</button>
        </div>:null}
      </div>)}
    </div>
    {editorOpen?<form className="loc-trace-route-composer" onSubmit={event=>{if(inDock)event.preventDefault();else void save(event);}}>
      <h4>{editingUid?'編輯':'新增'}{type==='path'?'路線圖':'痕跡圖'}</h4>
      <div className="scope-management-fields">
        <label>名稱<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
        <div className="loc-trace-description-field"><span>說明</span>
          <BlockNoteEditor editorKey={'route-note:'+owner+':'+(editingUid||type)}
            content={description} editable={!busy} plainTextOnly canInsertImage={false}
            suggestionKind="spatial" suggestions={suggestionRows}
            onPlainTextChange={setDescription}/>
        </div>
        <label>可見性
          <select className="scope-select" value={Number(invisible)} onChange={e=>setInvisible(e.target.value==='1')} disabled={busy}>
            <option value={0}>顯示</option><option value={1}>隱藏</option>
          </select>
        </label>
      </div>
      <div className="scope-stat-controls">
        <button type="button" className="loc-button" disabled={busy} onClick={()=>setShowMap(value=>!value)}>
          {showMap?'收起地圖選點':'展開地圖選點'}
        </button>
        <span className="scope-status">{type==='path'?'點選地圖上的地點，依序加入路線。':'先點起點，再點終點，即建立一段痕跡連線。'}{mapStart?' 已選起點：'+(anchorMap.get(mapStart)?.title||mapStart):''}</span>
      </div>
      {showMap?<TraceMap spatialData={{anchors:allAnchors,maps:preview?[preview,...records.filter(row=>routeUids.includes(row.uid))]:[]}}
        selectedRouteUid={preview?.uid||''} hideRoutePicker
        onAnchorSelect={addMapSelectedAnchor}/>:null}
      {type==='trace'?<details className="scope-card">
        <summary>第二層：所屬路線圖（{routeUids.length} 條）</summary>
        <p className="scope-status">由此指定空間痕跡圖包含哪些路線圖；連線關聯只用來組成痕跡圖，不影響其他紀錄的隱藏設定。</p>
        {records.filter(row=>row.trace_type==='path').map(route=><label key={route.uid}>
          <input type="checkbox" checked={routeUids.includes(route.uid)} disabled={busy}
            onChange={e=>setRouteUids(ids=>e.target.checked?[...ids,route.uid]:ids.filter(id=>id!==route.uid))}/>
          {route.title}（{route.uid}）
        </label>)}
      </details>:null}
      <h4>選擇地點</h4>
      {anchorIndex.isPending?<p className="scope-status">正在載入本 Scope 的地點標題…</p>:null}
      {anchorIndex.error?<p role="alert" className="scope-error">{String(anchorIndex.error.message||anchorIndex.error)}</p>:null}
      <div className="loc-trace-route-pickers">
        <div className="loc-trace-route-autocomplete">
          <label htmlFor="trace-spool-title-search">搜尋地點標題</label>
          <ScopeOptionPicker id="trace-spool-title-search"
            options={options.filter(opt=>!spool.includes(opt.value))}
            value={selectedAnchor?.value||''}
            onChange={id=>setSelectedAnchor(options.find(option=>option.value===id)||null)}
            disabled={busy||anchorIndex.isPending} resetKey={owner}
            placeholder="選擇已授權地點"
            noOptionsMessage="沒有符合地點"/>
        </div>
        <button className="loc-button" type="button" disabled={!selectedAnchor||busy} onClick={addToSpool}>＋ 加入候選地點</button>
      </div>
      <div className="loc-trace-selection-order">
        {spool.map(uid=><div key={uid} className="loc-trace-route-queue-actions">
          <span>{anchorMap.get(uid)?.title||uid} · {uid}</span>
          <button type="button" className="loc-button" disabled={busy} onClick={()=>removeFromSpool(uid)}>移除</button>
        </div>)}
      </div>
      <h4>{type==='path'?'安排路線站點順序':'安排痕跡線段'}</h4>
      {type==='path'?<>
        <div className="loc-trace-route-pickers">
          <ScopeOptionPicker id="trace-queue-stop" options={availableRoadOptions}
            value={selectedStop} onChange={setSelectedStop}
            disabled={busy||queue.length>=MAX_ROAD} resetKey={owner}
            placeholder="選擇下一站（選過即消失）"/>
          <button type="button" className="loc-button" onClick={addRoadStop}
            disabled={busy||!availableRoadOptions.some(option=>option.value===selectedStop)}>＋ 加入路線</button>
        </div>
        <ol className="loc-trace-selection-order">{queue.map((uid,i)=><li key={uid}>
          <span>{anchorMap.get(uid)?.title||uid}</span>
          <div className="loc-trace-route-queue-actions">
            <button type="button" className="loc-button" onClick={()=>shift(i,-1)} disabled={busy||i===0}>↑</button>
            <button type="button" className="loc-button" onClick={()=>shift(i,1)} disabled={busy||i===queue.length-1}>↓</button>
            <button type="button" className="loc-button" onClick={()=>setQueue(items=>items.filter(x=>x!==uid))} disabled={busy}>移除</button>
          </div>
        </li>)}</ol>
      </>:<>
        <div className="loc-trace-route-pickers" role="group" aria-label="新增痕跡線段">
          <label>起點
            <select className="scope-select" value={from} onChange={e=>setFrom(e.target.value)} disabled={busy}>
              <option value="">選擇地點</option>
              {poolOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>終點
            <select className="scope-select" value={to} onChange={e=>setTo(e.target.value)} disabled={busy}>
              <option value="">選擇地點</option>
              {poolOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" className="loc-button" disabled={busy||!from||!to||from===to}
            onClick={addPair}>＋ 加入線段</button>
        </div>
        <div className="loc-trace-selection-order">{pairs.map((pair,i)=><div key={pair.join(':')+':'+i}>
          {anchorMap.get(pair[0])?.title||pair[0]} — {anchorMap.get(pair[1])?.title||pair[1]}
          <button type="button" className="loc-button" disabled={busy}
            onClick={()=>setPairs(items=>items.filter((_,j)=>j!==i))}>移除</button>
        </div>)}</div>
      </>}
      <div className="scope-stat-controls">
        {!inDock?<button className="loc-button primary" type="submit" disabled={busy||!own||anchorIndex.isPending||Boolean(anchorIndex.error)||!title.trim()||
          (type==='path'?queue.length<2:!(pairs.length||routeUids.length))}>
          {busy?'儲存中…':'儲存'+(type==='path'?'路線圖':'痕跡圖')}
        </button>:null}
        {!inDock?<button type="button" className="loc-button" disabled={busy}
          onClick={()=>{if(allowLeave()){clear();setEditorOpen(false);}}}>取消</button>:null}
      </div>
    </form>:null}
    {!editorOpen&&showMap&&preview?<TraceMap spatialData={{anchors:previewAnchors,maps:[preview,...currentRouteMembers]}}
      selectedRouteUid={preview.uid} hideRoutePicker/>:null}
    {notice?<p role={error?'alert':'status'} className={'scope-status'+(error?' scope-error':'')}>{notice}</p>:null}
  </section>;
}
