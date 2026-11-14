'use client';

import {useState} from 'react';
import {useQueryClient} from '../../zenstack/client-queries';
import {useAccount} from './use-account';
import {useAsyncResource} from '../../zenstack/client-queries';
import {dbAuthClient} from './db-client.mjs';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';
import {invalidateAppBootstrapMetadata} from './app-bootstrap';

// Group administration only: enumerate existing members, rename display titles.
// Email, database/table mapping, create/delete and protected IDs never enter
// this component. The RPC enforces the same boundary server-side.
export default function LocGroupMemberList({groupId='loc'}){
  const account=useAccount();
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId===groupId);
  const queryClient=useQueryClient();
  const allowed=Boolean(account.user&&!account.loading&&!account.permissionLoading&&
    account.canLocAccessSync('group',groupId));
  const [draft,setDraft]=useState({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const query=useAsyncResource(['loc-group-member-list',groupId],async()=>{
    const {data,error}=await dbAuthClient.schema('silver')
      .managedAction('read_group_members',{p_group_id:groupId});
    if(error)throw new Error(error.message||'群組人員讀取失敗。');
    return Array.isArray(data)?data:[];
  },{enabled:allowed});
  const rows=query.data||[];
  const edited=rows.filter(row=>Object.hasOwn(draft,row.id)&&draft[row.id]!==row.display_name);
  const save=async()=>{
    if(!allowed||busy||query.isPending||query.error)return false;
    if(!edited.length)return true;
    setBusy(true);setNotice('');
    try{
      for(const row of edited){
        const name=String(draft[row.id]||'').trim();
        if(!name||name.length>120)throw new Error('人員名稱須為 1–120 字。');
        const {data,error}=await dbAuthClient.schema('silver').managedAction('update_group_member_name',{
          p_group_id:groupId,p_member_id:row.id,p_display_name:name
        });
        if(error||data!==true)throw new Error(error?.message||row.id+' 無法儲存。');
      }
      setDraft({});
      invalidateAppBootstrapMetadata();
      await Promise.all([query.refetch(),queryClient.invalidateQueries({queryKey:['app-bootstrap']})]);
      setNotice('群組人員資料已更新。');
      return true;
    }catch(error){setNotice(String(error?.message||error));return false;}
    finally{setBusy(false);}
  };
  useEditDockForm({isDirty:()=>edited.length>0,isBusy:()=>busy,save,
    discard:()=>{setDraft({});setNotice('');}});
  if(!allowed)return <section className="loc-card scope-status scope-error" role="alert">沒有群組人員修改權限。</section>;
  return <section className="loc-card admin-workspace">
    <h2>群組人員</h2>
    {query.isPending?<p className="scope-status" role="status">正在讀取人員…</p>:null}
    {query.error?<p className="scope-status scope-error" role="alert">{String(query.error.message||query.error)}
      <button type="button" className="loc-button" onClick={()=>query.refetch()}>重新讀取</button>
    </p>:null}
    {!query.isPending&&!query.error?<div className="scope-list">
      {rows.map(row=><article className="scope-inline-card" key={row.id}>
        <label><span>{row.id} · 顯示名稱</span>
          <input type="text" maxLength={120} value={draft[row.id]??row.display_name??''}
            disabled={busy} onChange={event=>setDraft(current=>({...current,[row.id]:event.target.value}))}/>
        </label>
      </article>)}
      {!rows.length?<p className="scope-status">目前沒有可修改的人員。</p>:null}
      <div className="scope-tabs">
        {!inDock?<button type="button" className="loc-button primary" disabled={busy||!edited.length} onClick={save}>儲存修改</button>:null}
        <button type="button" className="loc-button" disabled={busy||!edited.length}
          onClick={()=>{setDraft({});setNotice('');}}>還原</button>
      </div>
    </div>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}
