'use client';
import {useEffect,useState} from 'react';

// Scope role display is a business permission lookup in existing api.manage.
// A logged-in session alone does not confer an edit grant. No parallel
// Subject/Scope authorization database or Auth-managed ACL is created here.
export default function ScopeGroupAccessPanel({groupId}){
  const [rights,setRights]=useState(null);
  const [status,setStatus]=useState('');
  useEffect(()=>{
    let active=true;
    fetch('/api/loc-permissions',{
      method:'GET',credentials:'include',cache:'no-store',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
    }).then(async response=>{
      if(!response.ok)throw Error('LOC permission unavailable');
      return response.json();
    }).then(result=>{if(active)setRights(result)})
      .catch(()=>{if(active)setStatus('無法取得目前的 LOC 編輯權限。')});
    return()=>{active=false};
  },[groupId]);
  const grants=Array.isArray(rights?.grants)?rights.grants:[];
  const manager=Boolean(rights?.canManage||
    grants.includes(String(groupId)+':manage'));
  return <section className="loc-card scope-feature-card" aria-label="Scope Group 權限">
    <h2>Scope Group 權限</h2>
    <p className="scope-status">群組：{String(groupId||'')}</p>
    <p className="scope-status">網站的 Scope 與角色由主要資料庫
      <code>api.manage</code> 決定；LOC Auth 不處理或複製任何角色。</p>
    {rights?<p className="scope-status" role="status">
      {manager?'目前身分具備管理權限。':'目前身分不具備此群組的管理權限。'}
    </p>:<p className="scope-status" role="status">
      {status||'正在讀取權限…'}
    </p>}
  </section>;
}
