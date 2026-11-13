'use client';

import {useEffect,useMemo,useState} from 'react';
import {dbAuthClient} from './db-client.mjs';
import {reviewPlaceNameGroups,compactPlaceName} from '../modular/features/trace/trace-place-names.mjs';
import {renameTraceAnchorTitles} from '../modular/features/trace/trace-data';

const canonical=items=>[...items].sort((a,b)=>
  String(a.createtime||a.created_at||'9999').localeCompare(String(b.createtime||b.created_at||'9999'))||
  String(a.title||'').localeCompare(String(b.title||''),'zh-Hant'))[0];

export default function TraceOrganizer({scopeId,spatial,reload}){
  const anchors=useMemo(()=>(spatial.anchors||[]).filter(item=>
    item.trace_type==='space_anchor'&&item.source_scope===scopeId),[spatial.anchors,scopeId]);
  const {automatic,uncertain}=useMemo(()=>reviewPlaceNameGroups(anchors),[anchors]);
  const [dismissed,setDismissed]=useState([]);
  const [keepers,setKeepers]=useState({});
  useEffect(()=>{
    try{
      const value=JSON.parse(window.localStorage.getItem('loc-trace-distinct-v1:'+scopeId)||'[]');
      setDismissed(Array.isArray(value)?value:[]);
    }catch{setDismissed([]);}
  },[scopeId]);
  const reviewGroups=useMemo(()=>[
    ...automatic,...uncertain
  ].filter(group=>!dismissed.includes(group.key))
    .sort((a,b)=>b.items.length-a.items.length||
      String(canonical(a.items)?.title||'').localeCompare(String(canonical(b.items)?.title||''),'zh-Hant')||
      a.key.localeCompare(b.key)),[automatic,uncertain,dismissed]);
  const visibleGroups=reviewGroups.slice(0,80);
  const keepOf=group=>group.items.find(item=>item.uid===keepers[group.key])||canonical(group.items);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState(false);
  const [checked,setChecked]=useState({});
  const [placeName,setPlaceName]=useState('');
  const [selectedUid,setSelectedUid]=useState('');
  const [aliases,setAliases]=useState([]);
  const [newAlias,setNewAlias]=useState('');
  const ownPlaces=scopeId!=='loc';
  const place=anchors.find(item=>item.uid===selectedUid);
  useEffect(()=>{
    let live=true;
    if(!selectedUid||scopeId==='loc'){setAliases([]);return;}
    dbAuthClient.schema('silver').from(scopeId+'_anchor')
      .select('attr').eq('uid',selectedUid).eq('type','point').maybeSingle()
      .then(({data,error:loadError})=>{
        if(!live)return;
        if(loadError){setError(true);setNotice(String(loadError.message||loadError));return;}
        const location=data?.attr?.location;
        setAliases(Array.isArray(location)?location:
          typeof location==='string'&&location?[location]:[]);
      });
    return()=>{live=false;};
  },[scopeId,selectedUid]);
  const saveNames=async()=>{
    if(busy||!selectedUid)return;
    const list=[...new Set([...aliases,newAlias.trim()].filter(Boolean))];
    setBusy(true);setError(false);setNotice('');
    try{
      // The existing authorized action updates PointAnchor.attr.location atomically.
      const {data:written,error:saveError}=await dbAuthClient.schema('silver')
        .managedAction('save_scope_trace_place_names',{p_scope_id:scopeId,p_uid:selectedUid,
          p_names:[...new Set([...list,place?.title].filter(Boolean))]});
      if(saveError||written!==1)throw saveError||Error('名稱對照儲存結果未確認');
      const {data:current,error:readError}=await dbAuthClient.schema('silver')
        .from(scopeId+'_anchor').select('attr')
        .eq('uid',selectedUid).eq('type','point').maybeSingle();
      if(readError||!current)throw readError||Error('名稱對照讀回未完成');
      const names=current.attr?.location;
      setAliases(Array.isArray(names)?names:typeof names==='string'?[names]:[]);
      setNewAlias('');setNotice('已儲存 '+place.title+' 的名稱對照。');
    }catch(saveError){setError(true);setNotice(String(saveError.message||saveError));}
    finally{setBusy(false);}
  };
  const selectedIds=group=>group.items.filter(item=>
    item.uid!==keepOf(group).uid&&checked[group.key]?.[item.uid]).map(item=>item.uid);
  const selectGroup=(group,yes)=>setChecked(current=>({...current,[group.key]:
    Object.fromEntries(group.items.filter(item=>item.uid!==keepOf(group).uid)
      .map(item=>[item.uid,yes]))}));
  const selectAllGroups=yes=>setChecked(current=>{
    const next={...current};
    for(const group of reviewGroups)next[group.key]=Object.fromEntries(
      group.items.filter(item=>item.uid!==keepOf(group).uid).map(item=>[item.uid,yes]));
    return next;
  });
  const markDistinct=group=>{
    const next=[...new Set([...dismissed,group.key])];
    setDismissed(next);
    setChecked(current=>({...current,[group.key]:{}}));
    try{window.localStorage.setItem('loc-trace-distinct-v1:'+scopeId,JSON.stringify(next));}
    catch{setError(true);setNotice('本次已排除候選，但瀏覽器無法保存此選擇。');}
  };
  const renameGroup=async(group,uids)=>{
    const keep=keepOf(group);
    const change=[...new Set(uids)].filter(uid=>uid!==keep.uid&&
      group.items.some(item=>item.uid===uid&&item.title!==keep.title));
    if(!change.length)return 0;
    return renameTraceAnchorTitles({scopeId,uids:change,title:keep.title});
  };
  const saveChecked=async group=>{
    if(busy||!ownPlaces)return;
    const uids=selectedIds(group);
    if(!uids.length){setError(true);setNotice('請先勾選要統一名稱的地點。');return;}
    if(!window.confirm('確定將 '+uids.length+' 筆地點改名為「'+keepOf(group).title+'」？\\n每筆 UID、文章和路線都會保留。'))return;
    setBusy(true);setError(false);setNotice('');
    try{
      const changed=await renameGroup(group,uids);
      setChecked(previous=>({...previous,[group.key]:{}}));
      setNotice('已統一 '+changed+' 筆地點名稱；所有 UID、文章與路線都保留。');
      await reload();
    }catch(e){setError(true);setNotice(String(e.message||e));}
    finally{setBusy(false);}
  };
  const saveAllChecked=async()=>{
    if(busy||!ownPlaces)return;
    const groups=reviewGroups.map(group=>({group,uids:selectedIds(group)})).filter(item=>item.uids.length);
    const count=groups.reduce((sum,item)=>sum+item.uids.length,0);
    if(!count){setNotice('請先勾選要統一名稱的地點。');return;}
    if(!window.confirm('確定依各組指定的標準名稱，批次更新 '+groups.length+' 組、最多 '+count+' 筆？\\n僅更新標題；不刪除 UID、文章或路線。'))return;
    setBusy(true);setError(false);setNotice('');
    let changed=0,completed=0;
    try{
      for(const {group,uids} of groups){
        setNotice('正在統一名稱：'+(completed+1)+' / '+groups.length+' 組…');
        changed+=await renameGroup(group,uids);
        completed++;
        setChecked(previous=>({...previous,[group.key]:{}}));
      }
      setNotice('已整理 '+completed+' 組、更新 '+changed+' 筆名稱；全部 UID 保留。');
    }catch(e){
      setError(true);
      setNotice('已完成 '+completed+' 組，其餘未處理。原因：'+String(e.message||e));
    }finally{
      if(completed)try{await reload();}catch(e){setError(true);setNotice(n=>n+' 重新讀取失敗：'+String(e.message||e));}
      setBusy(false);
    }
  };
  const matches=useMemo(()=>{
    const q=compactPlaceName(placeName);
    if(!q)return [];
    return anchors.filter(item=>compactPlaceName(item.title).includes(q)).slice(0,30);
  },[anchors,placeName]);
  return <section className="loc-card scope-feature-card" aria-label="地點管理及名稱整理">
    <h3>地點管理 · 名稱整理</h3>
    <p className="scope-status">先搜尋並選擇要維護的地點；下方的自動候選可批次整理同座標的名稱。只修改名稱，不會合併或刪除文章、UID 與路線。</p>
    <div className="scope-stat-controls" role="status">
      <span>目前地點：{anchors.length}</span>
      <span>完整名稱排列候選：{automatic.length} 組</span>
      <span>需要確認：{uncertain.length} 組</span>
    </div>
    <section className="scope-card">
      <h4>1. 搜尋並管理既有地點</h4>
      <p className="scope-status">選取一筆地點後，可查看既有別名並新增名稱變體。</p>
      <label>搜尋既有地點
        <input type="search" value={placeName} placeholder="輸入名稱，不限縣市"
          onChange={event=>setPlaceName(event.target.value)}/>
      </label>
      {placeName.trim()&&!matches.length?<p className="scope-status" role="status">沒有符合搜尋條件的地點。</p>:null}
      {matches.length?<div className="loc-trace-name-results" role="group" aria-label="既有地點">
        {matches.map(item=><button className="loc-button" type="button" key={item.uid}
          onClick={()=>{setSelectedUid(item.uid);setNewAlias('');}}>
          {item.title} · UID {item.uid}
        </button>)}
      </div>:null}
      {place?<div className="scope-management-fields">
        <p><strong>目前選擇：</strong>{place.title} · UID {place.uid}</p>
        <p>已確認別名：{aliases.length?aliases.join('、'):'無'}</p>
        <label>新增名稱變體
          <input value={newAlias} maxLength={200} onChange={event=>setNewAlias(event.target.value)}
            placeholder="例如：WorldGym 新北永和店"/>
        </label>
        <button className="loc-button primary" type="button" disabled={busy||!ownPlaces||!newAlias.trim()}
          onClick={saveNames}>儲存名稱對照</button>
      </div>:null}
    </section>
    <section className="scope-card">
      <h4>2. 批次整理名稱排列候選</h4>
      <p className="scope-status">先展開候選組、選擇要保留的標準名稱，再勾選要更新的地點。候選依筆數排序。</p>
      <div className="scope-stat-controls">
        <button type="button" className="loc-button" disabled={busy||!ownPlaces||!visibleGroups.length}
          onClick={()=>selectAllGroups(true)}>全部勾選（所有 {reviewGroups.length} 組）</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>selectAllGroups(false)}>全部取消勾選</button>
        <button type="button" className="loc-button primary" disabled={busy||!ownPlaces||
          !reviewGroups.some(group=>selectedIds(group).length)}
          onClick={saveAllChecked}>統一全部已勾選名稱</button>
        {dismissed.length?<button type="button" className="loc-button" disabled={busy} onClick={()=>{
          setDismissed([]);
          try{window.localStorage.removeItem('loc-trace-distinct-v1:'+scopeId);}catch{}
        }}>還原已排除的 {dismissed.length} 組</button>:null}
      </div>
      {!reviewGroups.length?<p className="scope-status">沒有符合完整名稱排列及相同座標條件的候選。</p>:null}
      {visibleGroups.map(group=>{
        const keep=keepOf(group);
        const selectable=group.items.filter(item=>item.uid!==keep.uid);
        const selected=selectedIds(group);
        return <details key={group.key} className="loc-trace-article-choice">
          <summary>{keep.title} · {group.items.length} 筆 · {group.reason}</summary>
          <label>使用哪一筆作為標準名稱？
            <select className="scope-select" disabled={busy} value={keep.uid}
              onChange={event=>{
                setKeepers(current=>({...current,[group.key]:event.target.value}));
                setChecked(current=>({...current,[group.key]:{}}));
              }}>
              {group.items.map(item=><option key={item.uid} value={item.uid}>
                {item.title} · UID {item.uid}
              </option>)}
            </select>
          </label>
          {selectable.map(item=><label key={item.uid}>
            <input type="checkbox" disabled={busy||!ownPlaces} checked={Boolean(checked[group.key]?.[item.uid])}
              onChange={event=>setChecked(current=>({...current,[group.key]:{
                ...current[group.key],[item.uid]:event.target.checked
              }}))}/>
            {item.title} · UID {item.uid}
          </label>)}
          <div className="scope-stat-controls">
            <button type="button" className="loc-button" disabled={busy||!ownPlaces}
              onClick={()=>selectGroup(group,true)}>全選本組（{selectable.length} 筆）</button>
            <button type="button" className="loc-button" disabled={busy}
              onClick={()=>selectGroup(group,false)}>取消本組勾選</button>
            <button type="button" className="loc-button primary" disabled={busy||!ownPlaces||!selected.length}
              onClick={()=>saveChecked(group)}>統一已勾選名稱（{selected.length} 筆）</button>
            <button type="button" className="loc-button" disabled={busy}
              onClick={()=>markDistinct(group)}>不是同一地點 · 保持獨立</button>
          </div>
        </details>;
      })}
      {reviewGroups.length>80?<p className="scope-status">目前展開前 80 組；「全部勾選」涵蓋所有 {reviewGroups.length} 組，批次套用前請確認。</p>:null}
    </section>
    {notice?<p role={error?'alert':'status'} className={'scope-status'+(error?' scope-error':'')}>{notice}</p>:null}
  </section>;
}
