'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useSWRConfig} from 'swr';
import {useAsyncResource} from './use-async-resource';
import {dbAuthClient} from './db-client.mjs';
import {useAccount} from './use-account';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';
import {sourceSiteKeyForLabel} from './source-classification.mjs';

const KeywordNetworkEditor=dynamic(()=>import('./KeywordNetworkEditor'),{ssr:false});
const normalized=name=>String(name||'').trim();
const sourceName=name=>sourceSiteKeyForLabel(normalized(name));
const uidKey=(scope,item,index)=>scope+':'+(item.uid||'new:'+index);
function sourceNodes(catalog,scopeId,editing){
  const root={key:'universe',type:'universe',name:catalog.universe||'Eosteric',parent:null};
  const galaxy={key:'galaxy',type:'galaxy',name:catalog.galaxy||'LOC',parent:root.key};
  const nodes=[root,galaxy,{key:'domain:system',type:'domain',name:'system',parent:galaxy.key}];
  (scopeId==='loc'?editing:catalog.system||[]).forEach((item,i)=>{
    nodes.push({key:'system:'+i,type:'from',name:typeof item==='string'?item:item.name,
      parent:'domain:system',shared:true});
  });
  for(const record of catalog.scopes||[]){
    const domain='domain:'+record.scopeid;
    nodes.push({key:domain,type:'domain',name:record.scopeid,parent:galaxy.key,
      scopeid:record.scopeid});
    const rows=record.scopeid===scopeId?editing:
      record.sources.length?record.sources:record.legacy.map(name=>({name:sourceName(name)}));
    rows.forEach((item,i)=>nodes.push({
      key:uidKey(record.scopeid,item,i),type:'from',name:item.name,
      uid:item.uid||null,scopeid:record.scopeid,parent:domain
    }));
  }
  return nodes;
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
    const {data,error}=await dbAuthClient.schema('silver')
      .managedAction('read_source_catalog',{p_scope_id:scopeId});
    if(error)throw new Error(error.message||'無法讀取來源分類');
    return data;
  },{enabled:allowed});
  const catalog=query.data||{};
  const own=(catalog.scopes||[]).find(row=>row.scopeid===scopeId);
  const anchored=Boolean(own?.domain);
  const fallback=own?.legacy?.map(name=>({name:sourceName(name),label:name}))||[];
  const initial=global?(catalog.system||[]).map(name=>({name})):
    (own?.sources?.length?own.sources:anchored?[]:fallback);
  const original=useMemo(()=>initial.map(row=>({uid:row.uid,name:row.name,label:row.label||row.name})),
    // SWR values are immutable after a completed request.
    [query.data,scopeId]);
  const rows=draft??original;
  const changed=draft!==null&&JSON.stringify(rows)!==JSON.stringify(original);
  const legacyPending=!global&&!anchored&&fallback.length>0;
  const graph=useMemo(()=>query.data?sourceNodes(catalog,scopeId,rows):[],
    [query.data,scopeId,rows]);
  const update=(index,name,field='name')=>{setDraft(list=>{
    const next=(list??original).map(item=>({...item}));
    next[index][field]=name;return next;
  });setNotice('');};
  const add=()=>{setDraft(list=>[...(list??original),{name:'',label:''}]);setNotice('');};
  const remove=index=>{setDraft(list=>(list??original).filter((_,i)=>i!==index));setNotice('');};
  async function save(force=false){
    if(!allowed||busy||query.isPending||query.error)return false;
    if(!changed&&!force)return true;
    const items=rows.map(row=>({...(row.uid?{uid:row.uid}:{}),name:normalized(row.name),
      ...(!global?{label:normalized(row.label)||normalized(row.name)}:{})}));
    if(items.some(item=>!item.name||item.name.length>80||item.label?.length>80)){
      setNotice('每個來源名稱須為 1–80 字。');return false;
    }
    const ids=items.map(item=>item.name.normalize('NFKC').toLowerCase());
    if(new Set(ids).size!==ids.length){setNotice('來源名稱不可重複。');return false;}
    setBusy(true);setNotice('');
    try{
      const {data,error}=await dbAuthClient.schema('silver').managedAction(
        global?'update_group_default_article_class':'save_scope_sources',
        global?{p_group_id:'loc',p_names:items.map(item=>item.name)}:
          {p_scope_id:scopeId,p_sources:items}
      );
      if(error||data===false)throw new Error(error?.message||'來源分類儲存失敗');
      setDraft(null);
      await Promise.all([query.refetch(),
        mutate(key=>Array.isArray(key)&&/source|culture|statistics/.test(String(key[0]||'')))]);
      setNotice(global?'已儲存 LOC 系統來源。':
        '已儲存 Scope Anchor 來源；Galaxy.site 與 site_id 均未修改。');
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
          if(global&&node?.key==='domain:system'||!global&&node?.key==='domain:'+scopeId)add();
          else setNotice('只能在自己的來源分類新增項目。');
        }}/>
      {!global?<div className="scope-source-system-readonly">
        <h3>LOC 系統來源（唯讀）</h3>
        <p className="scope-status">{(catalog.system||[]).join('、')||'尚未設定系統來源'}</p>
      </div>:null}
      {global?<div className="scope-source-system-readonly">
        <h3>各 Scope（唯讀）</h3>
        {(catalog.scopes||[]).map(item=><p className="scope-status" key={item.scopeid}>
          {item.scopeid}：{(item.sources.length?item.sources:
            item.legacy.map(name=>({name:sourceName(name)}))).map(x=>x.name).join('、')||'尚未設定'}
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
        {legacyPending?<button className="loc-button" type="button" disabled={busy}
          onClick={()=>save(true)}>將既有分類導入 Anchor</button>:null}
        {!inDock?<button className="loc-button primary" type="button"
          disabled={busy||!changed} onClick={()=>save()}>
          {busy?'儲存中…':'儲存來源'}</button>:null}
      </div>
      {selected?<p className="scope-status" role="status">已選取節點：{graph.find(n=>n.key===selected)?.name||selected}</p>:null}
    </>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}
