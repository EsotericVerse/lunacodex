'use client';
import {useCallback,useEffect,useState} from 'react';
import UiText from '../../../i18n/UiText';
import {registerDefaultSection} from '../../../i18n/ui-copy';
import {useUiSection} from '../../../i18n/ui-locale';
import adminViewZh from '../../../i18n/sections/uiExtra.adminView.zh_tw.js';
import {useAccount} from '../../use-account';
import {dbAuthClient} from '../../db-client.mjs';
import {useEditDockForm} from '../../../modular/edit-dock';
registerDefaultSection('uiExtra.adminView',adminViewZh);

export default function AdminEmailBlocklist(){
  useUiSection('uiExtra.adminView');
  const account=useAccount();
  const [emails,setEmails]=useState([]);
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const {data,error}=await dbAuthClient.schema('silver').rpc('loc_admin_settings',
        {p_section:'email',p_operation:'read'});
      if(error)throw new Error(error.message||'系統黑名單讀取失敗');
      setEmails((data||[]).sort((a,b)=>a.email.localeCompare(b.email)));
    }catch(error){setMessage(String(error?.message||error));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  async function add(){
    const value=String(email||'').trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(value)){setMessage('Email 格式不正確。');return false;}
    if(value===String(account.email||'').toLowerCase()){
      setMessage('不可將目前登入的 Admin 帳號加入黑名單。');return;
    }
    setBusy(true);setMessage('');
    try{
      const {error}=await dbAuthClient.schema('silver').rpc('loc_admin_settings',
        {p_section:'email',p_operation:'add',p_key:value});
      if(error)throw new Error(error.message||'新增黑名單失敗');
      setEmail('');setMessage(value+' 已加入系統黑名單。');
      // The written row's shape is already known; update locally (sorted) instead
      // of re-reading the whole table just to show one more row.
      setEmails(current=>current.some(item=>item.email===value)?current:
        [...current,{email:value,created_at:new Date().toISOString()}]
          .sort((a,b)=>a.email.localeCompare(b.email)));
      return true;
    }catch(error){setMessage(String(error?.message||error));return false;}
    finally{setBusy(false);}
  }
  useEditDockForm({save:add,isDirty:()=>Boolean(email.trim()),isBusy:()=>busy});
  async function remove(value){
    if(!window.confirm('確認將 '+value+' 移出系統黑名單？'))return;
    setBusy(true);setMessage('');
    try{
      const {error}=await dbAuthClient.schema('silver').rpc('loc_admin_settings',
        {p_section:'email',p_operation:'remove',p_key:value});
      if(error)throw new Error(error.message||'移出黑名單失敗');
      setMessage(value+' 已移出黑名單。');
      setEmails(current=>current.filter(item=>item.email!==value));
    }catch(error){setMessage(String(error?.message||error));}
    finally{setBusy(false);}
  }
  return <section className="loc-card admin-workspace">
    <h2><UiText id="uiExtra.adminView.emailBlocklist"/></h2>
    <label><span><UiText id="uiExtra.adminView.blockedEmailAddress"/></span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <button type="button" className="loc-button primary" onClick={add} disabled={busy}><UiText id="uiExtra.adminView.addToBlocklist"/></button>
    {loading?<p className="scope-status">讀取中…</p>:null}
    {!loading&&emails.length===0?<p className="scope-status">目前沒有封鎖 Email。</p>:null}
    <div className="scope-list">
      {emails.map(item=><article className="scope-inline-card" key={item.email}>
        <strong>{item.email}</strong>
        <button type="button" className="loc-button" onClick={()=>remove(item.email)} disabled={busy}><UiText id="uiExtra.adminView.removeFromBlocklist"/></button>
      </article>)}
    </div>
    {message?<p className="scope-status" role="status">{message}</p>:null}
  </section>;
}
