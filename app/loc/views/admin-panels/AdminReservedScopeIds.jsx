'use client';

import {useState} from 'react';
import {useAsyncResource} from '../../use-async-resource';
import {useSWRConfig} from 'swr';
import {dbAuthClient} from '../../db-client.mjs';
import {useAccount} from '../../use-account';
import {useEditDockForm} from '../../../modular/edit-dock';

// The reserved ID list protects routing: this Admin page edits NOTES only.
// Adding, renaming and deleting reserved IDs are intentionally unavailable.

export default function AdminReservedScopeIds(){
  const account=useAccount();
  const {mutate}=useSWRConfig();
  const [notes,setNotes]=useState({});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const allowed=Boolean(account.user&&!account.loading&&!account.permissionLoading&&account.canManageGlobalSync());
  const query=useAsyncResource(['admin-reserved-scope-ids'],async()=>{
    const {data,error}=await dbAuthClient.schema('silver').rpc('loc_admin_settings',
      {p_section:'scopeid',p_operation:'read'});
    if(error)throw new Error(error.message||'保留名稱讀取失敗。');
    return (data||[]).sort((a,b)=>a.id.localeCompare(b.id));
  },{enabled:allowed});
  const rows=query.data||[];
  const changed=rows.filter(row=>String(notes[row.id]??row.note??'').trim()!==String(row.note||'').trim());

  async function save(){
    if(!allowed||busy||query.isPending||query.error)return false;
    if(!changed.length)return true;
    setBusy(true);setMessage('');
    try{
      for(const row of changed){
        const note=String(notes[row.id]??row.note??'').trim();
        const {error}=await dbAuthClient.schema('silver').rpc('loc_admin_settings',
          {p_section:'scopeid',p_operation:'note',p_key:row.id,p_value:note||''});
        if(error)throw new Error(error?.message||'備註未儲存。');
      }
      await mutate(key=>Array.isArray(key)&&['admin-reserved-scope-ids','settings-scope-registry'].includes(key[0]));
      setNotes({});
      setMessage('保留名稱備註已儲存。');
      return true;
    }catch(error){
      setMessage(String(error?.message||error));
      return false;
    }finally{setBusy(false);}
  }

  useEditDockForm({
    isDirty:()=>changed.length>0,
    isBusy:()=>busy,
    save,
    discard:()=>setNotes({})
  });

  if(account.loading||account.permissionLoading)return <section className="loc-card" role="status">正在確認 Admin 權限…</section>;
  if(!allowed)return <section className="loc-card scope-status scope-error" role="alert">只有 Admin 可以修改保留名稱備註。</section>;
  return <section className="loc-card admin-workspace scope-feature-card">
    <h2>保留名稱設定</h2>
    <h3>目前保留的名稱（{rows.length}）</h3>
    {query.isPending?<p className="scope-status" role="status">正在載入保留名稱…</p>:null}
    {query.error?<p className="scope-status scope-error" role="alert">{String(query.error.message||query.error)}</p>:null}
    {!query.isPending&&!query.error?<div className="admin-source-category-grid">
      {rows.map(row=><article className="admin-source-category-card" key={row.id}>
        <strong className="admin-source-category-card__code">{row.id}</strong>
        <label><span>備註</span><input maxLength={500} disabled={busy}
          value={notes[row.id]??row.note??''}
          onChange={event=>setNotes(current=>({...current,[row.id]:event.target.value}))}/>
        </label>
      </article>)}
    </div>:null}
    {message?<p className="scope-status" role="status">{message}</p>:null}
  </section>;
}
