'use client';

import {useEffect,useRef,useState} from 'react';
import {useAsyncResource} from './use-async-resource';
import {useQueryClient} from '@tanstack/react-query';
import {dbAuthClient} from './db-client.mjs';
import {useEditDock} from '../modular/edit-dock';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const HASH=/^[0-9a-f]{32}$/;
const EMPTY={scope_id:'lo3rwang',class_name:'',hash:''};
const keyOf=row=>JSON.stringify([row.scope_id,row.class_name]);

async function readRegistry(){
  const {data,error}=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',{
    p_section:'keywords',p_operation:'read'
  });
  if(error)throw Error(error.message||'關鍵詞管理資料讀取失敗');
  return (Array.isArray(data)?data:[]).sort((a,b)=>
    a.scope_id.localeCompare(b.scope_id)||a.class_name.localeCompare(b.class_name));
}

export default function LocKeywordManagement(){
  const queryClient=useQueryClient();
  const {data=[],isPending,error,refetch}=useAsyncResource(['loc-keywords-admin'],readRegistry);
  const editDock=useEditDock();
  const inDock=Boolean(editDock?.active&&editDock.scopeId==='loc');
  const [original,setOriginal]=useState(null);
  const [draft,setDraft]=useState({...EMPTY});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const saveRef=useRef(null);

  function choose(row){
    setOriginal(row?{scope_id:row.scope_id,class_name:row.class_name}:null);
    setDraft(row?{scope_id:row.scope_id,class_name:row.class_name,hash:row.hash}:{...EMPTY});
    setNotice('');
  }

  async function save(){
    if(busy)return false;
    const payload={
      scope_id:String(draft.scope_id||'').trim().toLowerCase(),
      class_name:String(draft.class_name||'').trim(),
      hash:String(draft.hash||'').trim().toLowerCase()
    };
    if(!SCOPE.test(payload.scope_id)||!payload.class_name||payload.class_name.length>120||!HASH.test(payload.hash)){
      setNotice('請確認 Scope ID、大群組名稱（1–120 字）及 32 位十六進位 Hash。');
      return false;
    }
    setBusy(true);setNotice('');
    try{
      const result=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',{
        p_section:'keywords',p_operation:'upsert',
        p_key:original?keyOf(original):null,p_value:payload
      });
      if(result.error)throw Error(result.error.message);
      if(!result.data?.scope_id)throw Error('資料未更新，請檢查 Admin 權限。');
      await queryClient.invalidateQueries({queryKey:['loc-keywords-admin']});
      choose(result.data);
      setNotice('已儲存。');
      return true;
    }catch(e){
      const message=String(e?.message||e);
      setNotice(message);
      editDock?.setNotice(message);
      return false;
    }finally{setBusy(false);}
  }
  saveRef.current={
    save,
    isDirty:()=>JSON.stringify(draft)!==JSON.stringify(
      original?data.find(row=>keyOf(row)===keyOf(original))||EMPTY:EMPTY
    ),
    isBusy:()=>busy
  };

  useEffect(()=>{
    if(!editDock?.active||editDock.scopeId!=='loc')return;
    return editDock.register({
      save:()=>saveRef.current.save(),
      isDirty:()=>saveRef.current.isDirty(),
      isBusy:()=>saveRef.current.isBusy()
    });
  },[editDock?.active,editDock?.scopeId,editDock?.register]);

  async function remove(){
    if(!original||busy)return;
    if(!window.confirm('確定刪除此大群組的 LOC 管理紀錄？不會刪除 Scope 內的原始關鍵詞。'))return;
    setBusy(true);setNotice('');
    try{
      const {data:removed,error:deleteError}=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',{
        p_section:'keywords',p_operation:'delete',p_key:keyOf(original)
      });
      if(deleteError)throw Error(deleteError.message);
      if(!removed?.deleted)throw Error('沒有刪除資料，請檢查 Admin 權限。');
      await queryClient.invalidateQueries({queryKey:['loc-keywords-admin']});
      choose(null);setNotice('已刪除管理紀錄。');
    }catch(e){setNotice(String(e?.message||e));}
    finally{setBusy(false);}
  }

  return <section className="loc-card admin-workspace">
    <h3>大群組設定</h3>
    {isPending?<p role="status">正在讀取關鍵詞大群組…</p>:null}
    {error?<p className="scope-status scope-error" role="alert">{String(error.message||error)}</p>:null}
    <div className="scope-stat-controls">
      <label><span>選擇大群組</span>
        <select className="scope-select" value={original?keyOf(original):''}
          disabled={busy} onChange={e=>choose(data.find(row=>keyOf(row)===e.target.value)||null)}>
          <option value="">新增管理紀錄</option>
          {data.map(row=><option key={keyOf(row)} value={keyOf(row)}>
            {row.scope_id} · {row.class_name}
          </option>)}
        </select>
      </label>
      <button type="button" className="loc-button" onClick={()=>refetch()} disabled={busy}>重新載入</button>
    </div>
    <div className="scope-stat-controls">
      <label><span>Scope ID</span>
        <input value={draft.scope_id} maxLength={15} disabled={busy}
          onChange={e=>setDraft(current=>({...current,scope_id:e.target.value}))}/>
      </label>
      <label><span>大群組名稱</span>
        <input value={draft.class_name} maxLength={120} disabled={busy}
          onChange={e=>setDraft(current=>({...current,class_name:e.target.value}))}/>
      </label>
      <label><span>Hash</span>
        <input value={draft.hash} maxLength={32} disabled={busy} spellCheck={false}
          onChange={e=>setDraft(current=>({...current,hash:e.target.value}))}/>
      </label>
    </div>
    <div className="scope-stat-controls">
      {!inDock?<button type="button" className="loc-button primary" disabled={busy} onClick={save}>
        {busy?'正在處理…':'儲存'}
      </button>:null}
      <button type="button" className="loc-button" disabled={busy} onClick={()=>choose(null)}>取消／新增</button>
      {original?<button type="button" className="loc-button" disabled={busy} onClick={remove}>刪除管理紀錄</button>:null}
    </div>
    {notice?<p role="status" className="scope-status">{notice}</p>:null}
  </section>;
}
