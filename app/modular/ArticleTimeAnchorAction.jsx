'use client';

import {useEffect,useId,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useAccount} from '../loc/auth/use-account';
import {selectManagedScope} from '../loc/scope/scope-data';
import {readAllAnchorFeature} from '../loc/model/feature-transaction-client.mjs';
import {insertRows} from '../loc/db/db-client.mjs';
import {allocateTimeUid} from '../loc/culture/time-anchor-ranges.mjs';
import {anniversarySuggestionsForDate} from '../loc/culture/anniversary.mjs';
import {editorSessionStatus,clearEditorSession,touchEditorSession} from '../loc/auth/edit-session-ttl.mjs';

const BlockNoteEditor=dynamic(()=>import('../loc/editor/BlockNoteEditor'),{loading:()=>null});
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));

async function findDateAnchor(scope,date){
  const rows=await readAllAnchorFeature({
    scope,family:'time',types:['date'],editor:true
  });
  const projected=rows.map(row=>({...row,type:'anchor',
    address:String(row.attr?.date||'').slice(0,10)}));
  return {existing:projected.find(row=>row.address===date)||null,all:projected};
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
      if(!verified?.authorizer?.canLocAccessSync('scope',scopeId))
        throw new Error('請先透過 LOC Auth 登入具有此 Scope 編輯權限的帳號。');
      // Explicit LOC Auth verification can renew a previously expired editor
      // session, without requiring a separate management-page visit.
      if(editorSessionStatus(window.sessionStorage).expired){
        clearEditorSession(window.sessionStorage);
        if(!touchEditorSession(window.sessionStorage))
          throw new Error('無法重新建立編輯 Session。');
      }
      const target=await selectManagedScope(scopeId);
      if(!target?.time)throw new Error('無法取得此 Scope 的時間資料表。');
      const timeRecords=await findDateAnchor(scopeId,date);
      const existing=timeRecords.existing;
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
        const suggested=anniversarySuggestionsForDate(date,timeRecords.all,{
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
      if(details.length>4000)throw new Error('時間定錨敘述最多 4000 字。');
      if(!validDay(date)||!table)throw new Error('定錨日期或資料表無效。');
      // The dialog may have remained open beyond the idle/session TTL.
      // Never bypass it: re-verify LOC Auth permission before renewing it.
      if(editorSessionStatus(window.sessionStorage).expired){
        const verified=await account.refresh({forceVerify:true});
        if(!verified?.authorizer?.canLocAccessSync('scope',scopeId))
          throw new Error('編輯 Session 已過期，請重新驗證此 Scope 的編輯權限。');
        clearEditorSession(window.sessionStorage);
        if(!touchEditorSession(window.sessionStorage))
          throw new Error('無法重新建立編輯 Session。');
      }
      const existing=(await findDateAnchor(scopeId,date)).existing;
      if(existing){
        onCreated?.(existing);
        setNotice('此日期已有時間定錨，已沿用原有紀錄。');
      }else{
        const uid=allocateTimeUid();
        const chosen=annualSuggestions.find(item=>item.title===details);
        const original=Date.parse(String(articleCreateTime||''));
        const record={uid,type:'date',title:chosen?.title||date,description:details,
          attr:{date},invisible:false,
          ...(Number.isFinite(original)?{createtime:new Date(original).toISOString()}:{})};
        const result=await insertRows(table,[record]);
        if(result?.count!==1)throw new Error('新增時間定錨未確認成功。');
        onCreated?.({...record,type:'anchor',address:date});
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
            onPlainTextChange={setDescription}/>
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
