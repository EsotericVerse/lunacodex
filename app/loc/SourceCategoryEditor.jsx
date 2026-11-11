'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAsyncResource} from './use-async-resource';
import {dbPublicClient,insertRows,updateRows,deleteRows} from './db-client.mjs';
import {allocateAnchorUid} from './unified-anchor-compat.mjs';
import {useEditDockForm} from '../modular/edit-dock';

// The very same graph canvas used by the personal Keyword editor.
const KeywordNetworkEditor=dynamic(()=>import('./KeywordNetworkEditor'),{ssr:false});
const TABLE='silver.loc_anchor';
const TYPES=['universe','galaxy','domain','from'];
const NEXT={universe:'galaxy',galaxy:'domain',domain:'from'};
const EMPTY_COUNTS={lo3rwang:0,lrunes:0};
const normalized=rows=>(rows||[]).map(row=>({
  ...row,attr:{...(row.attr||{}),uid:Array.isArray(row.attr?.uid)?row.attr.uid:[],
    counts:{...EMPTY_COUNTS,...(row.attr?.counts||{})}}
}));
async function fetchSources(){
  const {data,error}=await dbPublicClient.schema('silver').from('loc_anchor')
    .select('uid,type,title,description,invisible,attr,createtime,num').limit(200);
  if(error)throw error;
  return normalized(data);
}
// Existing public catalogue hook, now backed by the shared LOC source Anchor.
export function useSourceCategories(){
  return useAsyncResource(['loc-source-anchor'],async()=>{
    const nodes=await fetchSources();
    return {categories:nodes.filter(row=>row.type==='from').map(row=>row.title),
      aliases:[],groups:[],nodes};
  });
}

export function AdminSourceCategories(){
  const [nodes,setNodes]=useState([]);
  const [selected,setSelected]=useState('');
  const [draft,setDraft]=useState(null);
  const [pendingParent,setPendingParent]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const byUid=useMemo(()=>new Map(nodes.map(row=>[row.uid,row])),[nodes]);
  const current=byUid.get(selected)||null;
  const children=uid=>(byUid.get(uid)?.attr?.uid||[]).map(id=>byUid.get(id)).filter(Boolean);
  const isDirty=()=>Boolean(draft&&(
    !byUid.has(draft.uid)||
    draft.title!==(byUid.get(draft.uid)?.title||'')||
    draft.description!==(byUid.get(draft.uid)?.description||'')
  ));
  const canChangeNode=()=>!busy&&(!isDirty()||window.confirm('目前的來源修改尚未儲存，確定放棄變更？'));
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const found=await fetchSources();setNodes(found);
      setSelected(uid=>found.some(row=>row.uid===uid)?uid:'');
    }catch(e){setError(String(e.message||e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const edit=row=>{
    if(!row||row.uid===draft?.uid||!canChangeNode())return;
    setSelected(row.uid);
    setDraft({uid:row.uid,type:row.type,title:row.title||'',
      description:row.description||''});
    setPendingParent('');setError('');setNotice('');
  };
  const create=parent=>{
    if(!canChangeNode())return;
    const type=parent?NEXT[parent.type]:'universe';
    if(!type)return;
    const uid=allocateAnchorUid(new Set(nodes.map(row=>row.uid)));
    setSelected('');setPendingParent(parent?.uid||'');
    setDraft({uid,type,title:'',description:''});
    setError('');setNotice('');
  };
  const save=async()=>{
    if(!draft||busy)return false;
    const title=draft.title.trim();
    if(!title){setError('請填寫來源名稱');return false;}
    setBusy(true);setError('');setNotice('');
    try{
      const exists=byUid.has(draft.uid);
      if(exists){
        await updateRows(TABLE,{title,description:draft.description||null},{filters:[
          {column:'uid',operator:'eq',value:draft.uid}]});
      }else{
        const parent=byUid.get(pendingParent);
        if(draft.type!=='universe'&&(!parent||NEXT[parent.type]!==draft.type))
          throw Error('請先選擇正確的上一層來源節點');
        // The new node has its own UID and zeroed Scope counts. No title-based relation.
        await insertRows(TABLE,[{uid:draft.uid,type:draft.type,title,
          description:draft.description||null,
          attr:{uid:[],counts:{...EMPTY_COUNTS}}}]);
        if(parent){
          try{
            await updateRows(TABLE,{attr:{...parent.attr,
              uid:[...parent.attr.uid,draft.uid]}},{filters:[
              {column:'uid',operator:'eq',value:parent.uid}]});
          }catch(e){
            await deleteRows(TABLE,{filters:[{column:'uid',operator:'eq',value:draft.uid}]})
              .catch(()=>{});
            throw e;
          }
        }
      }
      await load();setSelected(draft.uid);setDraft(null);
      setNotice(exists?'來源名稱已更新。':'已新增來源並建立 UID 關聯。');
      return true;
    }catch(e){setError(String(e.message||e));return false;}
    finally{setBusy(false);}
  };
  // This editor is mounted only under Admin management. Use the existing six-key Save.
  useEditDockForm({save,isDirty,isBusy:()=>busy||loading,
    discard:()=>{setDraft(null);setError('');}});
  const remove=async()=>{
    if(!current||busy)return;
    if(children(current.uid).length){setError('此節點仍有下層來源，請先處理子節點。');return;}
    if(!window.confirm('確定刪除來源「'+current.title+'」？文章不會被刪除。'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const parent=nodes.find(row=>row.attr.uid.includes(current.uid));
      if(parent)await updateRows(TABLE,{attr:{...parent.attr,
        uid:parent.attr.uid.filter(uid=>uid!==current.uid)}},{filters:[
          {column:'uid',operator:'eq',value:parent.uid}]});
      await deleteRows(TABLE,{filters:[{column:'uid',operator:'eq',value:current.uid}]});
      await load();setSelected(parent?.uid||'');setDraft(null);
      setNotice('來源已刪除，原始文章未修改。');
    }catch(e){setError(String(e.message||e));}
    finally{setBusy(false);}
  };
  const roots=nodes.filter(row=>row.type==='universe');
  return <section className="loc-card scope-feature-card scope-keyword-management">
    <h2>文章來源</h2>
    <p className="scope-status">選取圖上節點編輯來源；儲存使用下方六鍵。</p>
    {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
    {loading?<p className="scope-status" role="status">讀取來源階層中…</p>:null}
    {!loading?<div className="scope-keyword-network-layout">
      <KeywordNetworkEditor sourceNodes={nodes} selectedId={selected}
        className="LOC 文章來源" classId="loc-sources"
        onSelectNode={node=>edit(byUid.get(node.uid))}
        onNewChild={node=>create(node?byUid.get(node.uid):null)}
        onMessage={setNotice}/>
      <aside className="scope-keyword-network-inspector" aria-label="LOC 來源節點編輯">
        <div className="scope-management-fields">
          <label><span>來源階層</span>
            <select className="scope-select" value={selected} onChange={e=>{
              const row=byUid.get(e.target.value);
              if(row)edit(row);
              else if(canChangeNode()){setSelected('');setDraft(null);}
            }}>
              <option value="">選擇來源</option>
              {roots.map(root=><optgroup key={root.uid} label={root.title}>
                {[root,...children(root.uid).flatMap(g=>[g,...children(g.uid).flatMap(d=>[d,...children(d.uid)])])]
                  .map(row=><option key={row.uid} value={row.uid}>
                    {TYPES.indexOf(row.type)?'　'.repeat(TYPES.indexOf(row.type)):''}{row.title}
                  </option>)}
              </optgroup>)}
            </select>
          </label>
        </div>
        {current?<details className="scope-source-meta">
          <summary>來源資料</summary>
          <p className="scope-status">UID：<code>{current.uid}</code> · {current.type}
            {' · '}lo3rwang：{Number(current.attr.counts.lo3rwang||0).toLocaleString()}
            {' · '}lrunes：{Number(current.attr.counts.lrunes||0).toLocaleString()}</p>
        </details>:null}
        <div className="scope-preview-links">
          <button type="button" className="loc-button" onClick={()=>create(null)} disabled={busy}>新增 Universe</button>
          <button type="button" className="loc-button" onClick={()=>create(current)}
            disabled={busy||!current||current.type==='from'}>新增下層</button>
          {current?<button type="button" className="loc-button" onClick={()=>edit(current)} disabled={busy}>編輯</button>:null}
        </div>
        {draft?<div className="scope-management-fields">
          <p className="scope-status">{byUid.has(draft.uid)?'編輯':'新增'} {draft.type} · UID：<code>{draft.uid}</code></p>
          <label><span>名稱</span><input value={draft.title} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/></label>
          <label><span>說明</span><textarea rows={3} value={draft.description}
            onChange={e=>setDraft(v=>({...v,description:e.target.value}))}/></label>
          <div className="scope-preview-links">
            {current&&current.uid===draft.uid?<button type="button" className="loc-button scope-danger-button"
              disabled={busy||children(current.uid).length>0} onClick={remove}>刪除</button>:null}
            <button type="button" className="loc-button" onClick={()=>{if(canChangeNode())setDraft(null);}} disabled={busy}>取消</button>
          </div>
        </div>:<p className="scope-status">選取圖上的節點，或透過選單開始編輯。</p>}
      </aside>
    </div>:null}
  </section>;
}
