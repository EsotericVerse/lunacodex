'use client';

import {useEffect,useRef,useState} from 'react';
import {useEditDock} from '../modular/edit-dock';
import {useUiCopy,useUiSection} from '../i18n/ui-locale';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import managementZh from '../i18n/sections/management.zh_tw.js';
import importUIZh from '../i18n/sections/uiExtra.importUI.zh_tw.js';
registerDefaultSection('management',managementZh);
registerDefaultSection('uiExtra.importUI',importUIZh);
import {insertRows} from './db-client.mjs';
import {useAccount} from './use-account';
import {createUid8} from './uid';
import {hasIrrecoverableEncoding,normalizeGalaxyContent,normalizeRelationIds,repairMojibakeText} from './content-policy';
import {refreshSunoStyleMetaTags} from './suno-style-meta-tags.mjs';
import BlockNoteEditor from './BlockNoteEditor';
import {blocksToPlainText,hasBlockNoteContent,plainTextToBlocks} from './blocknote-content.mjs';

export default function SunoImportPanel({scopeId,dockScopeId=scopeId,globalAdmin=false}){
  useUiSection('management');
  useUiSection('uiExtra.importUI');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const account=useAccount();
  const editDock=useEditDock();
  const activateDock=useRef(()=>{});
  const dockActions=useRef({save:null,discard:null});
  const inDock=Boolean(editDock?.active&&editDock.scopeId===dockScopeId);
  const freshSunoDraft=()=>({title:'',lyrics:'',lyricsBlocks:plainTextToBlocks(''),stylePrompt:'',stylePromptBlocks:plainTextToBlocks(''),stylePromptPlain:'',editorKey:createUid8(),url:'',createdDate:'',description:'',descriptionEdited:false,source_id:'',target_id:'',ref_id:''});
  const [draft,setDraft]=useState(freshSunoDraft);
  const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!inDock)return undefined;
    const unregister=editDock.register({
      save:()=>dockActions.current.save(),
      discard:()=>dockActions.current.discard(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
    activateDock.current=unregister.activate;
    return unregister;
  },[inDock,editDock?.register]);
  if(account.loading||account.permissionLoading)return <p className="scope-status" role="status">正在確認 Suno 管理權限…</p>;
  if(!account.canLocAccessSync('scope',scopeId)&&!(globalAdmin&&account.canLocAccessSync('global')))
    return <p className="scope-status scope-error" role="alert">目前沒有 Suno 音樂寫入權限。</p>;
  const change=(key,value)=>setDraft(current=>({
    ...current,[key]:value,
    ...(key==='stylePromptPlain'&&!current.descriptionEdited?{description:refreshSunoStyleMetaTags(value,current.description)}:{}),
    ...(key==='description'?{descriptionEdited:true}:{})
  }));
  function regenerateStyleTags(){
    setDraft(current=>({...current,description:refreshSunoStyleMetaTags(current.stylePromptPlain,current.description),descriptionEdited:false}));
  }
  async function save(event){
    event?.preventDefault?.();
    if(busy)return false;
    setBusy(true);setStatus('');
    try{
      const title=repairMojibakeText(draft.title).trim();
      const lyrics=normalizeGalaxyContent(draft.lyrics||blocksToPlainText(draft.lyricsBlocks));
      const stylePrompt=normalizeGalaxyContent(draft.stylePrompt||blocksToPlainText(draft.stylePromptBlocks));
      const description=repairMojibakeText(draft.description).trim();
      if([title,lyrics,stylePrompt,description].some(hasIrrecoverableEncoding))throw new Error(t('uiExtra.importUI.sunoEncoding'));
      if(!title)throw new Error(t('uiExtra.importUI.sunoTitleRequired'));
      const createtime=draft.createdDate?new Date(draft.createdDate+'T00:00:00+08:00').toISOString():new Date().toISOString();
      const lyricsUid=hasBlockNoteContent(lyrics)?createUid8():null;
      const styleUid=lyricsUid&&hasBlockNoteContent(stylePrompt)?createUid8():null;
      const mediaUid=createUid8();
      const sourceId=draft.source_id.trim()||(styleUid?draft.ref_id.trim():'')||null;
      const scopeData=account.scopeDataFor(scopeId);
      if(!scopeData)throw new Error(t('uiExtra.importUI.scopeUnresolved'));
      const {galaxy,galaxyMedia}=scopeData;
      if(lyricsUid){
        await insertRows(galaxy,[{
          uid:lyricsUid,
          title,content:lyrics,createtime,
          source_id:sourceId,target_id:normalizeRelationIds(draft.target_id),ref_id:styleUid||draft.ref_id.trim()||null,
          url:draft.url.trim()||null,site:'suno',media_link:[mediaUid],
          statics:true,culture:true,search:true,trace:true,list:true,keyword:true,others:true,extract:true
        }]);
      }
      if(styleUid){
        await insertRows(galaxy,[{
          uid:styleUid,
          title:title+'｜Suno Style',content:stylePrompt,createtime,
          target_id:[lyricsUid],site:'suno',
          statics:false,culture:false,search:false,trace:false,list:false,keyword:false,others:true,extract:true
        }]);
      }
      await insertRows(galaxyMedia,[{
        uid:mediaUid,
        type:'suno',
        title,url:draft.url.trim()||null,
        description:description||null,createtime
      }]);
      setStatus(t('uiExtra.importUI.sunoSaved'));setDraft(freshSunoDraft());
      return true;
    }catch(error){
      const message=error?.message||t('uiExtra.importUI.sunoSaveFailed');
      setStatus(message);
      if(inDock)editDock.setNotice(message);
      return false;
    }
    finally{setBusy(false);}
  }
  dockActions.current={
    save:()=>save(),
    discard:()=>{setDraft(freshSunoDraft());setStatus('')},
    isDirty:()=>Boolean(
      draft.title.trim()||blocksToPlainText(draft.lyrics).trim()||blocksToPlainText(draft.stylePrompt).trim()||
      blocksToPlainText(draft.lyricsBlocks).trim()||
      blocksToPlainText(draft.stylePromptBlocks).trim()||
      draft.stylePromptPlain.trim()||draft.url.trim()||draft.createdDate||
      draft.description.trim()||draft.source_id.trim()||draft.target_id.trim()||draft.ref_id.trim()
    ),
    isBusy:()=>busy
  };
  return <div className="scope-inline-card"
    onFocusCapture={()=>activateDock.current?.()}
    onPointerDownCapture={()=>activateDock.current?.()}>
    <h4><UiText id="uiExtra.importUI.sunoImport"/></h4>
    <form onSubmit={save} className="scope-editor">
      <label>{UI_COPY.management.songTitle}<input value={draft.title} onChange={e=>change('title',e.target.value)}/></label>
      <div className="scope-management-wide-field"><span>{UI_COPY.management.lyrics}</span>
        <BlockNoteEditor editorKey={'suno-lyrics:'+draft.editorKey} content={draft.lyricsBlocks}
          onBlocksChange={blocks=>setDraft(current=>current.editorKey===draft.editorKey
            ?{...current,lyricsBlocks:blocks}:current)}
          onHtmlChange={html=>setDraft(current=>current.editorKey===draft.editorKey
            ?{...current,lyrics:html}:current)}/>
      </div>
      <div className="scope-stat-controls">
        <label>Suno URL<input value={draft.url} onChange={e=>change('url',e.target.value)}/></label>
        <label><UiText id="common.date"/><input type="date" value={draft.createdDate} onChange={e=>change('createdDate',e.target.value)}/></label>
      </div>
      <div className="scope-stat-controls">
        <div className="scope-management-wide-field"><span>Suno Style</span>
          <BlockNoteEditor editorKey={'suno-style:'+draft.editorKey} content={draft.stylePromptBlocks}
            onBlocksChange={blocks=>setDraft(current=>current.editorKey!==draft.editorKey?current:{
              ...current,stylePromptBlocks:blocks,
              stylePromptPlain:blocksToPlainText(blocks),
              ...(!current.descriptionEdited?{description:refreshSunoStyleMetaTags(blocksToPlainText(blocks),current.description)}:{})
            })}
            onHtmlChange={html=>setDraft(current=>current.editorKey===draft.editorKey
              ?{...current,stylePrompt:html}:current)}/>
        </div>
        <label>內容／描述<input value={draft.description} onChange={e=>change('description',e.target.value)} placeholder={t('uiExtra.importUI.sunoStyleTagHint')}/></label>
        <button type="button" className="loc-button" onClick={regenerateStyleTags}><UiText id="uiExtra.importUI.sunoRegenerate"/></button>
      </div>
      <div className="scope-stat-controls">
        <label>source_id<input value={draft.source_id} onChange={e=>change('source_id',e.target.value)}/></label>
        <label>target_id<input value={draft.target_id} onChange={e=>change('target_id',e.target.value)}/></label>
        <label>ref_id<input value={draft.ref_id} onChange={e=>change('ref_id',e.target.value)}/></label>
      </div>
      {!inDock?<button type="submit" disabled={busy}>{busy?UI_COPY.common.saving:UI_COPY.management.addSuno}</button>:null}
      {status?<p className="scope-status">{status}</p>:null}
    </form>
  </div>;
}

