'use client';
import UiText,{useUiText} from '../i18n/UiText';
import {UI_COPY,registerDefaultSection} from '../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../i18n/ui-locale';
import managementZh from '../i18n/sections/management.zh_tw.js';
import importUIZh from '../i18n/sections/uiExtra.importUI.zh_tw.js';
registerDefaultSection('management',managementZh);
registerDefaultSection('uiExtra.importUI',importUIZh);
import {useEffect,useRef,useState} from 'react';
import {useEditDock} from '../modular/edit-dock';
import {insertRows,updateRows} from './db-client.mjs';
import {selectRows} from './db-query.mjs';
import {createUid8} from './uid';
import {useAccount} from './use-account';
import {hasIrrecoverableEncoding,repairMojibakeText} from './content-policy';
import {galaxyReadColumnsFor} from '../../zenstack/galaxy-read-models.mjs';

const blankMedia=()=>({
  galaxy_link:'',location:'',type:'',title:'',
  url:'',description:'',createtime:''
});

function mediaIso(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}

// 新增多媒體 belongs with publishing content (it creates a Galaxy Media
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
  const dockActions=useRef({save:null,discard:null,isDirty:null,isBusy:null});
  const [draft,setDraft]=useState(blankMedia);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!inDock)return undefined;
    return editDock.register({
      save:()=>dockActions.current.save(),
      discard:()=>dockActions.current.discard(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[inDock,editDock?.register]);
  if(account.loading||account.permissionLoading)return <p className="scope-status" role="status">正在確認多媒體管理權限…</p>;
  if(!account.canLocAccessSync('scope',scopeId)&&!(globalAdmin&&account.canLocAccessSync('global')))
    return <p className="scope-status scope-error" role="alert">目前沒有多媒體寫入權限。</p>;

  const change=(key,value)=>setDraft(current=>({...current,[key]:value}));

  async function save(event){
    event?.preventDefault?.();
    if(busy)return false;
    setBusy(true);setStatus('');
    try{
      const galaxyLink=String(draft.galaxy_link||'').trim();
      if(galaxyLink&&galaxyLink.length!==8)throw new Error(t('uiExtra.importUI.linkUidInvalid'));
      const mediaType=repairMojibakeText(draft.type).trim();
      if(!mediaType)throw new Error(t('uiExtra.importUI.mediaTypeRequired'));
      const mediaDescription=repairMojibakeText(draft.description).trim();
      const mediaTitle=repairMojibakeText(draft.title).trim();
      const sourcePlace=repairMojibakeText(draft.location).trim();
      if([mediaType,mediaDescription,mediaTitle,sourcePlace].some(hasIrrecoverableEncoding))throw new Error(t('uiExtra.importUI.mediaEncoding'));
      const scope=account.scopeDataFor(scopeId);
      const article=galaxyLink?(await selectRows(scope?.galaxy,{
        // The article lookup only needs the canonical anchor context; use the
        // shared projection instead of a one-off Galaxy column string.
        columns:galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor').join(','),
        filters:[{column:'uid',operator:'eq',value:galaxyLink}],
        limit:1,authenticated:true
      })).rows?.[0]:null;
      if(galaxyLink&&!article)throw new Error('找不到指定的文章 UID。');
      const mediaUid=createUid8();
      const record={
        uid:mediaUid,
        location:sourcePlace||null,
        type:mediaType,
        title:mediaTitle||null,
        url:String(draft.url||'').trim()||null,
        description:mediaDescription,
        createtime:article?.createtime?new Date(article.createtime).toISOString():
          mediaIso(draft.createtime)||new Date().toISOString()
      };
      const galaxyMedia=scope?.galaxyMedia;
      if(!galaxyMedia)throw new Error(t('uiExtra.importUI.scopeUnresolved'));
      await insertRows(galaxyMedia,[record]);
      if(article){
        const prior=Array.isArray(article.media_link)?article.media_link:[];
        await updateRows(scope.galaxy,{media_link:[...new Set([...prior,mediaUid])]},
          {filters:[{column:'uid',operator:'eq',value:article.uid}]});
      }
      setStatus(t('uiExtra.importUI.mediaSaved'));
      setDraft(blankMedia());
      return true;
    }catch(error){
      const message=error?.message||t('uiExtra.importUI.mediaSaveFailed');
      setStatus(message);if(inDock)editDock.setNotice(message);
      return false;
    }finally{setBusy(false);}
  }
  dockActions.current={
    save:()=>save(),
    discard:()=>{setDraft(blankMedia());setStatus('');},
    isDirty:()=>Object.keys(blankMedia()).some(key=>draft[key]!==blankMedia()[key]),
    isBusy:()=>busy
  };

  return <section className="loc-card scope-feature-card">
    <p className="loc-eyebrow">MEDIA</p>
    <h2>{UI_COPY.management.addMedia}</h2>
    <form onSubmit={save} className="scope-editor">
      <div className="scope-stat-controls">
        <label><span><UiText id="uiExtra.importUI.mediaTypeLabel"/></span><input value={draft.type} onChange={e=>change('type',e.target.value)} placeholder="ig_pic / facebook_pic / suno / video / url" required/></label>
        <label><span><UiText id="uiExtra.importUI.mediaArticleUidLabel"/></span><input value={draft.galaxy_link} onChange={e=>change('galaxy_link',e.target.value)} placeholder={t('uiExtra.importUI.mediaUidHint')}/></label>
        <label><span><UiText id="uiExtra.importUI.mediaCreatedAtLabel"/></span><input type="datetime-local" value={draft.createtime} onChange={e=>change('createtime',e.target.value)}/></label>
      </div>
      <div className="scope-stat-controls">
        <label><span><UiText id="uiExtra.importUI.mediaLocationLabel"/></span><input value={draft.location} onChange={e=>change('location',e.target.value)} placeholder={t('uiExtra.importUI.placeHint')}/></label>
      </div>
      <label><span><UiText id="uiExtra.importUI.mediaTitle"/></span><input value={draft.title} onChange={e=>change('title',e.target.value)}/></label>
      <label><span><UiText id="uiExtra.importUI.mediaExternalUrlLabel"/></span><input value={draft.url} onChange={e=>change('url',e.target.value)} placeholder={t('uiExtra.importUI.externalUrlHint')}/></label>
      <label><span><UiText id="uiExtra.importUI.mediaTagsLabel"/></span><input value={draft.description} onChange={e=>change('description',e.target.value)} placeholder={t('uiExtra.importUI.tagHint')}/></label>
      {!inDock?<button type="submit" disabled={busy}>{busy?UI_COPY.common.saving:UI_COPY.management.addMedia}</button>:null}
      {status?<p className="scope-status">{status}</p>:null}
    </form>
  </section>;
}

