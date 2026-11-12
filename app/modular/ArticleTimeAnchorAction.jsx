'use client';

import {useEffect,useId,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAccount} from '../loc/use-account';
import {selectManagedScope} from '../loc/scope-data';
import {DB_QUERY_BATCH_SIZE,selectRows} from '../loc/db-query.mjs';
import {insertRows} from '../loc/db-client.mjs';
import {allocateTimeUid} from '../loc/time-anchor-ranges.mjs';
import {anniversarySuggestionsForDate} from '../loc/anniversary.mjs';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from '../loc/edit-session-ttl.mjs';

const BlockNoteEditor=dynamic(()=>import('../loc/BlockNoteEditor'),{loading:()=>null});
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));

async function findDateAnchor(table,date){
  const {rows=[]}=await selectRows(table,{
    columns:'uid,title,description,address',
    filters:[{column:'type',operator:'eq',value:'anchor'},{column:'address',operator:'eq',value:date}],
    limit:1,authenticated:true
  });
  return rows[0]||null;
}

export default function ArticleTimeAnchorAction({
  scopeId='',date='',articleCreateTime='',onCreated=null,suggestions=[],label='新增時間定錨'
}){
  const account=useAccount({enabled:false});
  const dialogRef=useRef(null);
  const titleId=useId();
  const [checking,setChecking]=useState(false);
  const [saving,setSaving]=useState(false);
  const [open,setOpen]=useState(false);
  const [table,setTable]=useState('');
  const [description,setDescription]=useState('');
  const [descriptionRevision,setDescriptionRevision]=useState(0);
  const applySuggestedDescription=value=>{
    setDescription(value);setDescriptionRevision(revision=>revision+1);
  };
  const [annualSuggestions,setAnnualSuggestions]=useState([]);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return undefined;
    const dialog=dialogRef.current;
    if(dialog&&!dialog.open)dialog.showModal();
    return ()=>{if(dialog?.open)dialog.close();};
  },[open]);

  const close=()=>{
    if(saving)return;
    setOpen(false);
    setDescription('');
    setAnnualSuggestions([]);
  };

  const begin=async()=>{
    if(checking||saving)return;
    setChecking(true);
    setError('');
    setNotice('');
    setAnnualSuggestions([]);
    try{
      if(!validDay(date)||scopeId==='loc'||scopeId==='local')
        throw new Error('這篇文章沒有可用的時間定錨日期。');
      const verified=await account.refresh({forceVerify:true});
      if(!verified?.authorizer?.canManageScopeSync(scopeId))
        throw new Error('請先透過 Clerk 登入具有此 Scope 編輯權限的帳號。');
      // Explicit Clerk verification can renew a previously expired editor
      // session, without requiring a separate management-page visit.
      if(editorSessionStatus(window.sessionStorage).expired){
        clearEditorSession(window.sessionStorage);
        if(!touchEditorSession(window.sessionStorage))
          throw new Error('無法重新建立編輯 Session。');
      }
      const target=await selectManagedScope(scopeId);
      if(!target?.time)throw new Error('無法取得此 Scope 的時間資料表。');
      const existing=await findDateAnchor(target.time,date);
      if(existing){
        onCreated?.(existing);
        setNotice('此日期已有時間定錨，已沿用原有紀錄。');
        return;
      }
      setTable(target.time);
      const provided=Array.isArray(suggestions)?suggestions.filter(item=>item?.date===date):[];
      applySuggestedDescription(provided[0]?.title||'');
      setAnnualSuggestions(provided);
      setOpen(true);
      // Only check other anniversaries after the user explicitly opens
      // CREATE. Never preload all Time anchors on article detail read.
      // Suggestions are ephemeral; writes happen only on Submit.
      if(!provided.length)try{
        const {rows:existingAnchors}=await selectRows(target.time,{
          columns:'uid,type,title,address',
          filters:[{column:'type',operator:'eq',value:'anchor'}],
          limit:DB_QUERY_BATCH_SIZE,maxLimit:DB_QUERY_BATCH_SIZE,authenticated:true
        });
        const suggested=anniversarySuggestionsForDate(date,existingAnchors,{
          birthday:target.birthday
        });
        setAnnualSuggestions(suggested);
        if(suggested.length)applySuggestedDescription(suggested[0].title);
      }catch{setAnnualSuggestions([]);}

    }catch(cause){
      setError(String(cause?.message||cause||'無法確認編輯權限。'));
    }finally{
      setChecking(false);
    }
  };

  const save=async event=>{
    event.preventDefault();
    if(saving)return;
    setSaving(true);
    setError('');
    try{
      const details=description.trim();
      if(!details)throw new Error('請先填寫時間定錨的敘述。');
      if(!validDay(date)||!table)throw new Error('定錨日期或資料表無效。');
      // The dialog may have remained open beyond the idle/session TTL.
      // Never bypass it: re-verify Clerk permission before renewing it.
      if(editorSessionStatus(window.sessionStorage).expired){
        const verified=await account.refresh({forceVerify:true});
        if(!verified?.authorizer?.canManageScopeSync(scopeId))
          throw new Error('編輯 Session 已過期，請重新驗證此 Scope 的編輯權限。');
        clearEditorSession(window.sessionStorage);
        if(!touchEditorSession(window.sessionStorage))
          throw new Error('無法重新建立編輯 Session。');
      }
      const existing=await findDateAnchor(table,date);
      if(existing){
        onCreated?.(existing);
        setNotice('此日期已有時間定錨，已沿用原有紀錄。');
      }else{
        const uid=allocateTimeUid();
        const chosen=annualSuggestions.find(item=>item.title===details);
        const original=Date.parse(String(articleCreateTime||''));
        const record={uid,type:'anchor',title:chosen?.title||date,description:details,
          address:date,anchor_ids:null,invisible:false,
          ...(Number.isFinite(original)?{createtime:new Date(original).toISOString()}:{})};
        const result=await insertRows(table,[record]);
        if(result?.count!==1)throw new Error('新增時間定錨未確認成功。');
        onCreated?.(record);
        setNotice('已新增 '+date+' 的時間定錨。');
      }
      setOpen(false);
      setDescription('');
      setAnnualSuggestions([]);
    }catch(cause){
      setError(String(cause?.message||cause||'新增時間定錨失敗。'));
    }finally{
      setSaving(false);
    }
  };

  return <>
    <button type="button" className="loc-button" disabled={checking||saving}
      onClick={begin}>{checking?'正在確認權限…':label}</button>
    {notice?<span className="scope-status" role="status">{notice}</span>:null}
    {!open&&error?<span className="scope-status scope-error" role="alert">{error}</span>:null}
    {open?<dialog ref={dialogRef} className="scope-edit-switch-dialog"
      aria-labelledby={titleId} onCancel={event=>{event.preventDefault();close();}}>
      <h2 id={titleId}>新增時間定錨</h2>
      <p className="scope-status">定錨日期：{date}</p>
      <form className="scope-editor" onSubmit={save}>
        {annualSuggestions.length?<div className="scope-status" role="group"
          aria-label="週年紀念虛擬定錨建議">
          <strong>週年紀念建議（虛擬定錨，尚未儲存）</strong>
          {annualSuggestions.map(item=><div key={item.sourceUid+':'+item.date}>
            <span>{item.title}｜原始定錨 {item.sourceDate}</span>
            <button type="button" className="loc-button" disabled={saving}
              onClick={()=>applySuggestedDescription(item.title)}>套用建議</button>
          </div>)}
        </div>:null}
        <div className="scope-culture-quick-notes"><span>敘述</span>
          <BlockNoteEditor editorKey={'inline-time-note:'+scopeId+':'+date+':'+descriptionRevision}
            content={description} editable={!saving} plainTextOnly canInsertImage={false}
            suggestionKind="time"
            suggestions={annualSuggestions.map(item=>({type:'aniversary',title:item.title}))}
            onPlainTextChange={value=>{if(value.length<=4000)setDescription(value);}}/>
        </div>
        {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
        <div className="scope-edit-switch-actions">
          <button type="submit" className="loc-button" disabled={saving||!description.trim()}>
            {saving?'正在新增…':'確認新增'}
          </button>
          <button type="button" className="loc-button" onClick={close} disabled={saving}>取消</button>
        </div>
      </form>
    </dialog>:null}
  </>;
}
