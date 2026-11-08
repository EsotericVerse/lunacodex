'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useSWRConfig} from 'swr';
import {useAsyncResource} from './use-async-resource';
import {sourceCatalogService} from './source-catalog-client.mjs';
import {useAccount} from './use-account';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';

const KeywordNetworkEditor=dynamic(()=>import('./KeywordNetworkEditor'),{ssr:false});
const normalized=name=>String(name||'').trim();
// The server and public sites now share exactly one ZModel Source tree. Keep
// existing saved physical keys; overlay only the editor's own draft leaves.
function sourceNodes(catalog,scopeId,editing){
  const nodes=(catalog.tree||[]).map(node=>({...node,children:[...(node.children||[])]}));
  const global=scopeId==='loc';
  const parent=nodes.find(node=>node.type==='domain'&&
    (global?node.domain_kind==='system'&&node.source_scope==='loc':
      node.domain_kind==='scope'&&node.source_scope===scopeId));
  if(!parent)return nodes;
  const retained=nodes.filter(node=>!(node.type==='from'&&node.parent===parent.key));
  parent.children=[];
  editing.forEach((item,index)=>{
    const name=String(item?.name||'').trim(),uid=String(item?.uid||'');
    const key=uid?'from:'+scopeId+':'+uid:
      name?'from:'+scopeId+':'+name.normalize('NFKC').toLowerCase():
        'draft:'+scopeId+':'+index;
    const node={key,type:'from',name:name||'新來源',label:item?.label||name,
      ...(uid?{uid}:{}),parent:parent.key,source_scope:scopeId,
      domain_kind:parent.domain_kind,site:name,children:[]};
    parent.children.push(key);retained.push(node);
  });
  return retained;
}

// LOC and Scope have different management locations and independent write
// ownership. This component is only the shared presentation and edit shell.
// The trusted Kysely action filters sibling Scopes BEFORE returning any rows.
export default function FlatClassificationEditor({scopeId='loc'}){
  const account=useAccount(),dock=useEditDock(),{mutate}=useSWRConfig();
  const global=scopeId==='loc';
  const inDock=Boolean(dock?.active&&dock.scopeId===scopeId);
  const allowed=Boolean(account.user&&!account.loading&&!account.permissionLoading&&
    (global?account.canManageGroupSync('loc'):account.canManageScopeSync(scopeId)));
  const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''),[selected,setSelected]=useState('');
  const query=useAsyncResource(['source-anchor-catalog',scopeId],async()=>{
    return sourceCatalogService('read',scopeId);
  },{enabled:allowed});
  const catalog=query.data||{};
  const own=(catalog.scopes||[]).find(row=>row.scopeid===scopeId);
  const initial=global?(catalog.system||[]).map(name=>({name})):
    (own?.sources||[]);
  const original=useMemo(()=>initial.map(row=>({uid:row.uid,name:row.name,label:row.label||row.name})),
    // SWR values are immutable after a completed request.
    [query.data,scopeId]);
  const rows=draft??original;
  const changed=draft!==null&&JSON.stringify(rows)!==JSON.stringify(original);
  const graph=useMemo(()=>query.data?sourceNodes(catalog,scopeId,rows):[],
    [query.data,scopeId,rows]);
  const update=(index,name,field='name')=>{setDraft(list=>{
    const next=(list??original).map(item=>({...item}));
    next[index][field]=name;return next;
  });setNotice('');};
  const add=()=>{setDraft(list=>[...(list??original),{name:'',label:''}]);setNotice('');};
  const remove=index=>{setDraft(list=>(list??original).filter((_,i)=>i!==index));setNotice('');};
  async function save(){
    if(!allowed||busy||query.isPending||query.error)return false;
    if(!changed)return true;
    const items=rows.map(row=>({...(row.uid?{uid:row.uid}:{}),name:normalized(row.name),
      ...(!global?{label:normalized(row.label)||normalized(row.name)}:{})}));
    if(items.some(item=>!item.name||item.name.length>80||item.label?.length>80)){
      setNotice('每個來源名稱須為 1–80 字。');return false;
    }
    const ids=items.map(item=>item.name.normalize('NFKC').toLowerCase());
    if(new Set(ids).size!==ids.length){setNotice('來源名稱不可重複。');return false;}
    setBusy(true);setNotice('');
    try{
      const result=await sourceCatalogService(
        global?'save_system':'save_scope',scopeId,
        global?items.map(item=>item.name):items
      );
      if(result===false)throw new Error('來源分類儲存失敗');
      setDraft(null);
      await Promise.all([query.refetch(),
        mutate(key=>Array.isArray(key)&&/source|culture|statistics/.test(String(key[0]||'')))]);
      setNotice(global?'已儲存 LOC 系統來源；公開頁快照仍須重新發布。':
        '已儲存 Scope Anchor 來源；Galaxy.site 不變，公開頁快照仍須重新發布。');
      return true;
    }catch(e){setNotice(String(e?.message||e));return false;}
    finally{setBusy(false);}
  }
  useEditDockForm({save:()=>save(),isDirty:()=>changed,isBusy:()=>busy,
    discard:()=>{setDraft(null);setNotice('');}});
  if(!allowed)return <section className="loc-card scope-status scope-error" role="alert">無來源管理權限。</section>;
  return <section className="loc-card classification-inline" aria-label="來源分類管理">
    <h2>{global?'LOC 來源分類':'Scope 來源分類 · '+scopeId}</h2>
    <p className="scope-status">{global
      ?'LOC 可以檢視各 Scope 的來源，但只能修改 LOC 系統來源。'
      :'系統來源與上層分類為唯讀；只能修改自己的來源，其他 Scope 不可見。'}</p>
    {query.isPending?<p role="status">正在讀取來源列表…</p>:null}
    {query.error?<p className="scope-status scope-error" role="alert">
      {String(query.error.message||query.error)}
      <button className="loc-button" type="button" onClick={()=>query.refetch()}>重新讀取</button>
    </p>:null}
    {query.data?<>
      <KeywordNetworkEditor sourceNodes={graph} className="來源" classId={'sources:'+scopeId}
        onSelectNode={node=>setSelected(node.key)}
        onNewChild={node=>{
          if(node?.type==='domain'&&node.source_scope===scopeId&&
             node.domain_kind===(global?'system':'scope'))add();
          else setNotice('只能在自己的來源分類新增項目。');
        }}/>
      {!global?<div className="scope-source-system-readonly">
        <h3>LOC 系統來源（唯讀）</h3>
        <p className="scope-status">{(catalog.system||[]).join('、')||'尚未設定系統來源'}</p>
      </div>:null}
      {global?<div className="scope-source-system-readonly">
        <h3>各 Scope（唯讀）</h3>
        {(catalog.scopes||[]).map(item=><p className="scope-status" key={item.scopeid}>
          {item.scopeid}：{item.sources.map(x=>x.label||x.name).join('、')||'尚未設定'}
        </p>)}
      </div>:null}
      <h3>{global?'LOC 系統來源':'我的來源'}</h3>
      <div className="classification-inline__list">
        {rows.map((item,i)=><div className="classification-inline__row" key={item.uid||'draft:'+i}>
          <label className="classification-inline__field">
            <span>{i+1}.</span>
            <input type="text" value={item.name} maxLength={80}
              aria-label={'來源代碼 '+(i+1)} disabled={busy||!global&&Boolean(item.uid)}
              title={!global&&item.uid?'來源代碼保留比對 Galaxy.site，需更名請用來源更正工具。':undefined}
              onChange={e=>update(i,e.target.value)}/>
            {!global?<input type="text" value={item.label??item.name} maxLength={80}
              aria-label={'顯示名稱 '+(i+1)} disabled={busy}
              onChange={e=>update(i,e.target.value,'label')}/>:null}
          </label>
          <div className="classification-inline__controls">
            <button type="button" disabled={busy} onClick={()=>remove(i)}
              aria-label={'刪除來源 '+(i+1)}>×</button>
          </div>
        </div>)}
      </div>
      <div className="classification-inline__actions">
        <button className="loc-button" type="button" disabled={busy} onClick={add}>新增來源</button>
        {!inDock?<button className="loc-button primary" type="button"
          disabled={busy||!changed} onClick={()=>save()}>
          {busy?'儲存中…':'儲存來源'}</button>:null}
      </div>
      {selected?<p className="scope-status" role="status">已選取節點：{graph.find(n=>n.key===selected)?.name||selected}</p>:null}
    </>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}
