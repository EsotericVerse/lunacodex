'use client';
import UiText,{useUiText} from '../../i18n/UiText';
import {UI_COPY} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import {useEffect,useRef,useState} from 'react';
import {useEditDock} from '../../modular/edit-dock';
import {transactionWrites} from '../db/db-client.mjs';
import {useAccount} from '../auth/use-account';
import {hasIrrecoverableEncoding,repairMojibakeText} from '../content/content-policy';

const blankMedia=()=>({
  galaxy_link:'',type:'image',title:'',
  url:'',description:'',createtime:''
});


// 新增多媒體 belongs with publishing content (it creates a MediaAnchor
// record the same way publishing an article creates a Galaxy record), not
// with 資料匯入 (batch/file import of existing external data).
export default function ManagementMediaPublisher({scopeId,dockScopeId=scopeId,globalAdmin=false}){
  const UI_COPY=useUiCopy();
  const t=useUiText();
  useUiSection('management');
  useUiSection('uiExtra.importUI');
  const account=useAccount();
  const editDock=useEditDock();
  const inDock=Boolean(editDock?.active&&editDock.scopeId===dockScopeId);
  const dockActions=useRef({save:null,prepareTransaction:null,discard:null,isDirty:null,isBusy:null});
  const [draft,setDraft]=useState(blankMedia);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!inDock)return undefined;
    return editDock.register({
      save:()=>dockActions.current.save(),
      prepareTransaction:()=>dockActions.current.prepareTransaction(),
      discard:()=>dockActions.current.discard(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[inDock,editDock?.register]);
  if(account.loading||account.permissionLoading)return <p className="scope-status" role="status">正在確認多媒體管理權限…</p>;
  if(!account.canLocAccessSync('scope',scopeId)&&!(globalAdmin&&account.canLocAccessSync('global')))
    return <p className="scope-status scope-error" role="alert">目前沒有多媒體寫入權限。</p>;

  const change=(key,value)=>setDraft(current=>({...current,[key]:value}));

  async function prepareMediaTransaction(){
    if(busy)throw Error('多媒體儲存仍在執行');
    const galaxyLink=String(draft.galaxy_link||'').trim();
    if(galaxyLink&&galaxyLink.length!==8)throw new Error(t('uiExtra.importUI.linkUidInvalid'));
    const mediaType=repairMojibakeText(draft.type).trim();
    if(!mediaType)throw new Error(t('uiExtra.importUI.mediaTypeRequired'));
    const mediaDescription=repairMojibakeText(draft.description).trim();
    const mediaTitle=repairMojibakeText(draft.title).trim();
    if([mediaType,mediaDescription,mediaTitle].some(hasIrrecoverableEncoding))
      throw new Error(t('uiExtra.importUI.mediaEncoding'));
    const href=String(draft.url||'').trim();
    if(!/^https?:\/\/[^\s]+$/i.test(href))throw Error('請提供有效的 HTTP(S) 媒體網址');
    if(!galaxyLink)throw Error('請選擇要連結的 Galaxy 文章 UID；獨立文字請建立 Galaxy 文章');
    const scope=account.scopeDataFor(scopeId);
    if(!scope?.galaxy)throw Error(t('uiExtra.importUI.scopeUnresolved'));
    const operations=[{p_table:scope.galaxy,p_operation:'append_media_link',
      p_values:{article_uid:galaxyLink,media_url:href}}];
    return {operations,
      afterCommit:()=>{
        setStatus(t('uiExtra.importUI.mediaSaved'));
        setDraft(blankMedia());
      },
      onFailure:error=>{
        const message=error?.message||t('uiExtra.importUI.mediaSaveFailed');
        setStatus(message);
        if(inDock)editDock.setNotice(message);
      }};
  }
  async function save(event){
    event?.preventDefault?.();
    if(busy)return false;
    setBusy(true);setStatus('');
    try{
      const plan=await prepareMediaTransaction();
      await transactionWrites(plan.operations);
      try{await plan.afterCommit();}
      catch{setStatus('資料已提交，但畫面更新失敗；請重新整理。');}

      return true;
    }catch(error){
      const message=error?.message||t('uiExtra.importUI.mediaSaveFailed');
      setStatus(message);if(inDock)editDock.setNotice(message);
      return false;
    }finally{setBusy(false);}
  }
  dockActions.current={
    save:()=>save(),
    prepareTransaction:()=>prepareMediaTransaction(),
    discard:()=>{setDraft(blankMedia());setStatus('');},
    isDirty:()=>Object.keys(blankMedia()).some(key=>draft[key]!==blankMedia()[key]),
    isBusy:()=>busy
  };

  return <section className="loc-card scope-feature-card">
    <p className="loc-eyebrow">MEDIA</p>
    <h2>{UI_COPY.management.addMedia}</h2>
    <form onSubmit={save} className="scope-editor">
      <div className="scope-stat-controls">
        <label><span><UiText id="uiExtra.importUI.mediaTypeLabel"/></span>
          <select value={draft.type} onChange={e=>change('type',e.target.value)} required>
            <option value="image">圖片</option><option value="video">影片</option>
            <option value="suno">Suno 音樂</option><option value="rune">符文媒體</option>
          </select></label>
        <label><span><UiText id="uiExtra.importUI.mediaArticleUidLabel"/></span><input value={draft.galaxy_link} onChange={e=>change('galaxy_link',e.target.value)} placeholder={t('uiExtra.importUI.mediaUidHint')}/></label>
        <label><span><UiText id="uiExtra.importUI.mediaCreatedAtLabel"/></span><input type="datetime-local" value={draft.createtime} onChange={e=>change('createtime',e.target.value)}/></label>
      </div>
      <label><span><UiText id="uiExtra.importUI.mediaTitle"/></span><input value={draft.title} onChange={e=>change('title',e.target.value)}/></label>
      <label><span><UiText id="uiExtra.importUI.mediaExternalUrlLabel"/></span><input value={draft.url} onChange={e=>change('url',e.target.value)} placeholder={t('uiExtra.importUI.externalUrlHint')}/></label>
      <label><span><UiText id="uiExtra.importUI.mediaTagsLabel"/></span><input value={draft.description} onChange={e=>change('description',e.target.value)} placeholder={t('uiExtra.importUI.tagHint')}/></label>
      {!inDock?<button type="submit" disabled={busy}>{busy?UI_COPY.common.saving:UI_COPY.management.addMedia}</button>:null}
      {status?<p className="scope-status">{status}</p>:null}
    </form>
  </section>;
}

