'use client';
import {useState} from 'react';
import {scopeTagNames} from './scope-config-fields.mjs';
import {useAsyncResource} from './use-async-resource';
import {useScopeSourceCategoryRow} from './scope-source-category-row.mjs';
import {dbAuthClient,dbAuthRelation,readScopeCategoryTotals} from './db-client.mjs';
import {useAccount} from './use-account';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';
import {defaultScopeData} from './scope-data';
import {canonicalImportSourceName} from './source-name.mjs';
import {useUiLocale} from '../i18n/ui-locale';
function ScopeSourceCorrectionEditor({scopeId}){
  const account=useAccount();
  const {locale}=useUiLocale();
  const l=({
    'zh-Hant':{title:'匯入來源更正',from:'目前來源名稱',to:'更正為',preview:'預覽更正筆數',confirm:'請使用首頁編輯功能列的「儲存」確認更正。',denied:'請先從 Scope 首頁進入編輯模式，並確認此 Scope 管理權限。'},
    'zh-Hans':{title:'导入来源更正',from:'当前来源名称',to:'更正为',preview:'预览更正数量',confirm:'请使用首页编辑工具栏的“保存”确认更正。',denied:'请先从 Scope 首页进入编辑模式并确认管理权限。'},
    en:{title:'Correct import source',from:'Current source name',to:'Change to',preview:'Preview matching records',confirm:'Use Save in the homepage editing toolbar to apply.',denied:'Enter editing mode from the Scope homepage with management permission.'},
    ja:{title:'インポート元の修正',from:'現在の出典名',to:'修正後の出典名',preview:'対象件数を確認',confirm:'ホームの編集ツールバーで「保存」を押してください。',denied:'Scope ホームから編集モードに入り、管理権限を確認してください。'}
  })[locale]||({title:'匯入來源更正',from:'目前來源名稱',to:'更正為',preview:'預覽更正筆數',confirm:'請使用首頁的「儲存」確認。',denied:'請先從 Scope 首頁進入編輯模式。'});
  const dock=useEditDock();
  const allowed=Boolean(account.user&&dock?.active&&dock.scopeId===scopeId&&account.canManageScopeSync(scopeId));
  const [before,setBefore]=useState(''),[after,setAfter]=useState('');
  const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''),[completed,setCompleted]=useState(0);
  const systemRow=useScopeSourceCategoryRow('loc',{enabled:allowed});
  const personalRow=useScopeSourceCategoryRow(scopeId,{enabled:allowed});
  const totalsQuery=useAsyncResource(['scope-source-category-totals',scopeId],
    ()=>readScopeCategoryTotals(scopeId),{enabled:allowed});
  const sourceLists={
    data:systemRow.data!==undefined&&personalRow.data!==undefined&&totalsQuery.data!==undefined?{
      system:scopeTagNames('loc',systemRow.data),
      personal:scopeTagNames(scopeId,personalRow.data),
      observed:(totalsQuery.data||[]).filter(row=>row.kind==='source').map(row=>row.category)
    }:undefined,
    error:systemRow.error||personalRow.error||totalsQuery.error,
    refetch:()=>Promise.all([systemRow.refetch(),personalRow.refetch(),totalsQuery.refetch()])
  };
  const canonicalAfter=canonicalImportSourceName(after,sourceLists.data?.system||[],sourceLists.data?.personal||[]);
  const sourceOptions=[...new Set([...(sourceLists.data?.system||[]),...(sourceLists.data?.personal||[]),...(sourceLists.data?.observed||[])].filter(Boolean))];
  const dirty=Boolean(before.trim()&&canonicalAfter&&before.trim()!==canonicalAfter);
  const signature=before+'\u0000'+after;
  const table=account.scopeDataFor(scopeId)?.galaxy||defaultScopeData(scopeId)?.galaxy;
  const clearPreview=()=>{setPreview(null);setNotice('');setCompleted(0);};
  async function inspect(){
    if(!allowed||busy||!dirty||!table)return;
    setBusy(true);setNotice('');
    try{
      const {count,error}=await dbAuthRelation(table).select('uid',{head:true,count:'exact'}).eq('site',before.trim());
      if(error)throw new Error(error.message);
      setPreview({signature,count:Number(count)||0});
      setNotice('符合的文章 '+Number(count||0).toLocaleString()+' 篇；只修改來源名稱，不修改文章內容。');
    }catch(e){setPreview(null);setNotice(String(e.message||e));}
    finally{setBusy(false);}
  }
  async function save(){
    if(!allowed||busy||!dirty||!preview||preview.signature!==signature||!preview.count)return false;
    setBusy(true);setNotice('正在更正來源名稱…');
    let changed=0;
    try{
      for(let batch=0;batch<1000;batch++){
        const {data,error}=await dbAuthClient.schema('silver').managedAction('rename_scope_site_batch',{
          p_scope_id:scopeId,p_before:before.trim(),p_after:canonicalAfter,p_batch_size:1000
        });
        if(error)throw new Error(error.message);
        const count=Number(data)||0;
        if(count===0)break;
        changed+=count;setCompleted(changed);
        if(count<1000)break;
        if(batch===999)throw new Error('來源更正已達安全批次上限，請重新預覽剩餘筆數。');
      }
      setBefore('');setAfter('');setPreview(null);
      setNotice('已更正 '+changed.toLocaleString()+' 篇文章，UID 與原文未變更。');
      await sourceLists.refetch();
      return true;
    }catch(e){setPreview(null);setNotice('已處理 '+changed.toLocaleString()+' 篇；其餘尚未更正：'+String(e.message||e));return false;}
    finally{setBusy(false);}
  }
  const activateEditor=useEditDockForm({save,isDirty:()=>dirty,isBusy:()=>busy,
    discard:()=>{setBefore('');setAfter('');setPreview(null);setNotice('');setCompleted(0);}});
  if(!allowed)return <p className="scope-status scope-error" role="alert">{l.denied}</p>;
  return <section className="loc-card scope-feature-card"
    onFocusCapture={activateEditor} onPointerDownCapture={activateEditor}>
    <h2>{l.title}</h2>
    {sourceLists.error?<div className="scope-status scope-error" role="alert">
      無法載入來源建議：{String(sourceLists.error.message||sourceLists.error)}。
      可自行輸入來源名稱，或<button type="button" className="loc-button" disabled={busy} onClick={()=>sourceLists.refetch()}>重新載入建議</button>
    </div>:null}
    <datalist id={'scope-source-names-'+scopeId}>{sourceOptions.map(name=><option key={name} value={name}/>)}</datalist>
    <div className="scope-management-fields">
      <label>{l.from}<input type="text" list={'scope-source-names-'+scopeId} value={before} maxLength={80} disabled={busy}
        onChange={e=>{setBefore(e.target.value);clearPreview();}}/></label>
      <label>{l.to}<input type="text" list={'scope-source-names-'+scopeId} value={after} maxLength={80} disabled={busy}
        onChange={e=>{setAfter(e.target.value);clearPreview();}}/></label>
    </div>
    <button type="button" className="loc-button" onClick={inspect} disabled={busy||!dirty}>{l.preview}</button>
    {preview?.signature===signature?<p role="status" className="scope-status">{preview.count.toLocaleString()} · {l.confirm}</p>:null}
    {completed>0?<p role="status" className="scope-status">已更正 {completed.toLocaleString()} 篇。</p>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}


// This editor is an optional maintenance action, not an import prerequisite.
// Keep its three source-list queries and edit-dock registration unmounted until
// the manager deliberately opens the source correction tool.
export default function ScopeSourceCorrection({scopeId}){
  const [expanded,setExpanded]=useState(false);
  const {locale}=useUiLocale();
  const title=({
    'zh-Hant':'匯入來源更正','zh-Hans':'导入来源更正',
    en:'Correct import source',ja:'インポート元の修正'
  })[locale]||'匯入來源更正';
  return <div className="scope-source-correction">
    <button type="button" className="loc-button"
      aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
      {expanded?'− ':'＋ '}{title}
    </button>
    {expanded?<ScopeSourceCorrectionEditor scopeId={scopeId}/>:null}
  </div>;
}
