'use client';

import {useEffect,useRef,useState} from 'react';
import {useEditDock} from '../modular/edit-dock';
import dynamic from 'next/dynamic';
import {useQueryClient} from '../../zenstack/client-queries';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import editBlocksZh from '../i18n/sections/uiExtra.editBlocks.zh_tw.js';
import frameEditorZh from '../i18n/sections/uiExtra.frameEditor.zh_tw.js';
registerDefaultSection('uiExtra.editBlocks',editBlocksZh);
registerDefaultSection('uiExtra.frameEditor',frameEditorZh);
import {HomeBlock} from './home-block-model';
import {BlockNoteContent} from './blocknote-content.mjs';
import {resolveHomeImage} from './LocHomeBlockDisplay';
import {isHomeFrameFor} from './hero-image.mjs';
import {HeroImageFieldset} from './HeroImageFields';
import {appBootstrapKey} from './app-bootstrap';
import {invalidateScopeBlockPage} from './scope-data';
import {planHomeBlockWrites} from './home-block-draft-plan.mjs';

const BlockNoteEditor=dynamic(()=>import('./BlockNoteEditor'),{loading:()=>null});
const ObjectEditor=dynamic(()=>import('./BlockNoteEditor').then(mod=>mod.ObjectEditor),{loading:()=>null});

const TITLE_LIMIT=64;
const EYEBROW_LIMIT=64;
const SUBTITLE_LIMIT=128;

function stripInlineImage(value){
  return String(value||'').replace(/<img\b[^>]*>/gi,'');
}

export default function ScopeBlockDraftList({
  slots,scopeId,pageName,allowDelete=true,allowEntities=true,allowImages=true,
  editEyebrow=true,canAddBlock=false,slotClassName='loc-card',editSlotClassName='',
  preserveOrder=false,toolbar=null,onDone,onCancel,onDirtyChange=null
}){
  useUiSection('uiExtra.editBlocks');
  useUiSection('uiExtra.frameEditor');
  const t=useUiText();
  const queryClient=useQueryClient();
  const editDock=useEditDock();
  const dockActions=useRef({save:null,discard:null});
  const inDock=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  function report(message){
    setMessage(message);
    if(inDock)editDock?.setNotice(message);
  }
  const initialDrafts=useRef(null);
  const [drafts,setDrafts]=useState(()=>{
    const initial=slots.map(slot=>({
      ...slot,entities:HomeBlock.normalizeEntities(slot.entities),_deleted:false
    }));
    initialDrafts.current=JSON.stringify(initial);
    return initial;
  });
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  async function publishSavedBlocks(rows){
    // The rows were committed by SQL. Update the active viewer from those exact
    // saved values: do not start two independent SELECTs on every Dock Save.
    // Future visits to this edited page read the live provider, not published JS.
    invalidateScopeBlockPage(scopeId,pageName);
    await Promise.all([
      queryClient.setQueryData(appBootstrapKey(scopeId,pageName),
        current=>current?{...current,blocks:rows}:current),
      queryClient.setQueryData(['scope-blocks',scopeId,pageName],rows)
    ]);
  }

  function patchDraft(uid,patch){
    setDrafts(current=>current.map(draft=>draft.uid===uid?{...draft,...patch}:draft));
  }
  function patchImage(uid,changes,removeEmbedded=true){
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid)return draft;
      const base=draft.image&&typeof draft.image==='object'?draft.image:{};
      const next={...draft,image:{...base,...changes}};
      return removeEmbedded?{...next,
        subtitle:stripInlineImage(next.subtitle),
        text:stripInlineImage(next.text),
        entities:next.entities.map(entity=>({...entity,text:stripInlineImage(entity.text)}))
      }:next;
    }));
  }
  function canInsertImageIn(draft,html=''){
    return BlockNoteContent.image.frameImageCount(draft)-BlockNoteContent.image.countHtmlImages(html)===0;
  }
  function updateEntity(uid,index,patch){
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid)return draft;
      const entities=draft.entities.map((entity,entityIndex)=>entityIndex===index?{...entity,...patch}:entity);
      return {...draft,entities};
    }));
  }
  function addEntity(uid){
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid||draft.entities.length>=HomeBlock.entityLimit)return draft;
      return {...draft,entities:[...draft.entities,{uid:HomeBlock.createUid(),title:'',text:'',order:draft.entities.length+1}]};
    }));
  }
  function removeEntity(uid,index){
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid)return draft;
      const mode=BlockNoteContent.image.heroImageMode(draft);
      const entities=draft.entities.filter((_,entityIndex)=>entityIndex!==index)
        .map((entity,entityIndex)=>({...entity,order:entityIndex+1}));
      if(draft.order===1&&entities.length){
        entities.forEach(entity=>delete entity.image_mode);
        if(mode==='side')entities[0].image_mode='side';
      }
      return {...draft,entities};
    }));
  }
  function moveEntity(uid,index,direction){
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid)return draft;
      const target=index+direction;
      if(target<0||target>=draft.entities.length)return draft;
      const mode=BlockNoteContent.image.heroImageMode(draft);
      const entities=[...draft.entities];
      [entities[index],entities[target]]=[entities[target],entities[index]];
      const ordered=entities.map((entity,entityIndex)=>({...entity,order:entityIndex+1}));
      if(draft.order===1&&ordered.length){
        ordered.forEach(entity=>delete entity.image_mode);
        if(mode==='side')ordered[0].image_mode='side';
      }
      return {...draft,entities:ordered};
    }));
  }
  function toggleDelete(uid){
    if(!allowDelete)return;
    setDrafts(current=>current.map(draft=>draft.uid===uid?{...draft,_deleted:!draft._deleted}:draft));
  }
  function moveBlock(uid,direction){
    setDrafts(current=>{
      const visible=current.filter(draft=>!draft._deleted);
      const index=visible.findIndex(draft=>draft.uid===uid);
      const target=index+direction;
      if(!HomeBlock.canSwapHomeBlockPositions(pageName,visible,index,target))return current;
      const reordered=[...visible];
      [reordered[index],reordered[target]]=[reordered[target],reordered[index]];
      const deleted=current.filter(draft=>draft._deleted);
      return [...reordered,...deleted];
    });
  }
  function addBlock(){
    setDrafts(current=>{
      const nextOrder=Math.max(0,...current.map(draft=>Number(draft.order)||0))+1;
      return [...current,{
        uid:HomeBlock.createUid(),stored:false,order:nextOrder,
        eyebrow:'',title:'',subtitle:'',text:'',image:null,entities:[],bubbleColumns:HomeBlock.defaultBubbleColumns(pageName),_deleted:false
      }];
    });
  }

  async function save({switching=false}={}){
    if(busy)return false;
    setBusy(true);setMessage('');
    if(inDock)editDock?.setNotice('');
    const plan=planHomeBlockWrites(drafts,JSON.parse(initialDrafts.current||'[]'),{preserveOrder});
    const {changed}=plan;
    for(const {draft,modified} of changed){
      if(!modified)continue;
      if(!BlockNoteContent.text.hasBlockNoteFrameContent(draft)){
        setBusy(false);report(t('uiExtra.editBlocks.emptyContent'));return false;
      }
      if(Array.from(String(draft.title||'')).length>TITLE_LIMIT){
        setBusy(false);report(t('uiExtra.frameEditor.titleTooLong',{limit:TITLE_LIMIT}));return false;
      }
      if(Array.from(String(draft.eyebrow||'')).length>EYEBROW_LIMIT){
        setBusy(false);report(t('uiExtra.frameEditor.eyebrowTooLong',{limit:EYEBROW_LIMIT}));return false;
      }
      if(Array.from(String(draft.subtitle||'')).length>SUBTITLE_LIMIT){
        setBusy(false);report(t('uiExtra.frameEditor.subtitleTooLong',{limit:SUBTITLE_LIMIT}));return false;
      }
      const isHomeFrame=isHomeFrameFor(scopeId,pageName,draft.order);
      if(isHomeFrame&&draft.image?.source==='custom'&&String(draft.image.url||'').trim()&&!BlockNoteContent.image.normalizeImageSource(draft.image.url)){
        setBusy(false);report(t('uiExtra.frameEditor.imageUrlInvalid'));return false;
      }
      const embeddedImages=BlockNoteContent.image.frameImageCount(draft);
      if(!allowImages&&embeddedImages>0){setBusy(false);report(t('uiExtra.editBlocks.textOnly'));return false;}
      if(embeddedImages>1){setBusy(false);report(t('uiExtra.editBlocks.oneImage'));return false;}
      if(embeddedImages===1&&!BlockNoteContent.image.firstFrameImageUrl(draft)){setBusy(false);report(t('uiExtra.editBlocks.invalidImage'));return false;}
    }
    try{
      const {dbAuthClient}=await import('./db-client.mjs');
      const normalizeSavedHtml=value=>scopeId==='loc'&&pageName==='index'
        ?HomeBlock.stripLocHomeEditorPlaceholders(value):String(value??'');
      const savedDrafts=[];
      const committedRows=[];
      for(const {index,draft,order} of changed){
        const isHomeFrame=isHomeFrameFor(scopeId,pageName,draft.order);
        const values={
          page_name:pageName,
          block_eyebrow:HomeBlock.plainBlockLine(draft.eyebrow),
          block_title:HomeBlock.plainBlockLine(draft.title),
          block_subtitle:HomeBlock.plainBlockLine(draft.subtitle),
          block_image:draft.image?.source==='custom'&&!String(draft.image.url||'').trim()
            ?JSON.stringify({...draft.image,source:'default',url:''})
            :draft.image?JSON.stringify(draft.image):null,
          block_text:normalizeSavedHtml(draft.text),
          block_order:order,
          block_entity:HomeBlock.serializeBubbleEntities(draft.bubbleColumns,
            HomeBlock.normalizeEntities(draft.entities).map(({uid,title,text,image_mode},entityIndex)=>({
              uid,title:String(title||'').trim(),text:normalizeSavedHtml(text),
              ...(pageName==='index'&&draft.order===1&&entityIndex===0&&image_mode==='side'?{image_mode:'side'}:{})
            })),pageName)
        };
        const uid=draft.stored?draft.uid:
          /^[A-Za-z0-9]{8}$/.test(String(draft.uid||''))?draft.uid:HomeBlock.createUid();
        savedDrafts.push({...draft,uid,stored:true,order:values.block_order,_deleted:false});
        committedRows.push({uid,...values});
      }
      if(plan.hasWrites){
        // Exactly one managed request. Authority is checked once by the server;
        // the entire page commits or rolls back in one transaction.
        const {error}=await dbAuthClient.schema('silver').managedAction('save_blocks',{
          p_scope_id:scopeId,p_type:pageName,p_rows:committedRows
        });
        if(error)throw new Error(error.message||'Blocks 批次儲存失敗');
      }
      // A successful SQL write is final, not a temporary save. Cache updates
      // are local only; failure to update SWR does not undo the database write.
      let refreshWarning='';
      if(plan.hasWrites){
        try{await publishSavedBlocks(committedRows);}
        catch{refreshWarning='資料已儲存，但畫面同步失敗，重新整理頁面即可。';}
      }
      setDrafts(savedDrafts);
      initialDrafts.current=JSON.stringify(savedDrafts);
      onDone(refreshWarning||t('uiExtra.editBlocks.saved'),{switching});
      return true;
    }catch(error){
      report(t('uiExtra.editBlocks.saveFailedPrefix')+String(error?.message||error||t('uiExtra.editBlocks.unknown')));
      return false;
    }finally{
      setBusy(false);
    }
  }

  function renderDraftEntities(draft){
    return <div className="scope-block-entity-grid" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([draft.bubbleColumns],pageName)}}>
      {draft.entities.map((entity,index)=><article className={HomeBlock.childPresentation(entity.title)==='card'?'scope-block-entity':'loc-bubble scope-block-text-bubble'} key={entity.uid}>
        <div className="scope-block-entity-actions">
          <button type="button" className="loc-button" disabled={index===0||busy} onClick={()=>moveEntity(draft.uid,index,-1)}>←</button>
          <button type="button" className="loc-button" disabled={index===draft.entities.length-1||busy} onClick={()=>moveEntity(draft.uid,index,1)}>→</button>
          <button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>removeEntity(draft.uid,index)}><UiText id="uiExtra.editBlocks.remove"/></button>
        </div>
        <label className="scope-management-wide-field">
          <span><UiText id="uiExtra.editBlocks.childTitleHint"/></span>
          <input className="scope-search-input" placeholder={t('uiExtra.editBlocks.bubbleHint')} value={entity.title}
            onChange={event=>updateEntity(draft.uid,index,{title:event.target.value})}/>
        </label>
        <BlockNoteEditor
          editorKey={entity.uid+':draft'}
          content={entity.text?{html:entity.text}:''}
          onHtmlChange={html=>updateEntity(draft.uid,index,{text:html})}
          canInsertImage={allowImages&&canInsertImageIn(draft,entity.text)}
        />
      </article>)}
      {draft.entities.length<HomeBlock.entityLimit?<button type="button" className="scope-block-entity-add" onClick={()=>addEntity(draft.uid)} disabled={busy}>
        <UiText id="uiExtra.editBlocks.addChild"/>
      </button>:null}
    </div>;
  }

  function renderDraft(draft,index,visibleDrafts){
    const isHomeFrame=isHomeFrameFor(scopeId,pageName,draft.order);
    const image=isHomeFrame?resolveHomeImage(draft,scopeId):null;
    const pinnedHero=HomeBlock.isPinnedHomeHero(pageName,draft);
    return <section className={(editSlotClassName||slotClassName)+' scope-editable-block scope-block-draft'} key={draft.uid}>
      <div className="scope-inline-editbar">
        {visibleDrafts.length>1&&!pinnedHero?<button type="button" className="loc-button" disabled={busy||!HomeBlock.canSwapHomeBlockPositions(pageName,visibleDrafts,index,index-1)} onClick={()=>moveBlock(draft.uid,-1)}><UiText id="uiExtra.editBlocks.moveUp"/></button>:null}
        {visibleDrafts.length>1&&!pinnedHero?<button type="button" className="loc-button" disabled={busy||!HomeBlock.canSwapHomeBlockPositions(pageName,visibleDrafts,index,index+1)} onClick={()=>moveBlock(draft.uid,1)}><UiText id="uiExtra.editBlocks.moveDown"/></button>:null}
        {allowDelete?<button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>toggleDelete(draft.uid)}><UiText id="uiExtra.editBlocks.remove"/></button>:null}
      </div>
      <div className="scope-editor-stage"><h3 className="scope-editor-stage__title">文字內容</h3><p className="scope-editor-stage__help">依序設定標題、副標題與正文；下方另行設定圖片及附屬內容。</p>
      <ObjectEditor mode="scope" fields={[
        ...(editEyebrow?[{
          key:'eyebrow',label:<UiText id="uiExtra.editBlocks.englishEyebrow"/>,
          value:draft.eyebrow,maxLength:EYEBROW_LIMIT,onChange:value=>patchDraft(draft.uid,{eyebrow:value})
        }]:[]),
        {
          key:'title',label:<UiText id="uiExtra.editBlocks.chineseHeadline"/>,
          value:draft.title,maxLength:TITLE_LIMIT,onChange:value=>patchDraft(draft.uid,{title:value})
        },
        {
          key:'subtitle-line',label:<UiText id="uiExtra.editBlocks.subtitle"/>,
          value:HomeBlock.plainBlockLine(draft.subtitle),maxLength:SUBTITLE_LIMIT,
          onChange:value=>patchDraft(draft.uid,{subtitle:value})
        },
        {
          key:'body',kind:'rich',label:<UiText id="uiExtra.editBlocks.body"/>,
          editorKey:draft.uid+':draft:body',content:draft.text?{html:draft.text}:'',
          onHtmlChange:html=>patchDraft(draft.uid,{text:html}),
          canInsertImage:allowImages&&!isHomeFrame&&canInsertImageIn(draft,draft.text)
        }
      ]}/>
      </div>
      {isHomeFrame?<div className="scope-editor-stage"><h3 className="scope-editor-stage__title">主視覺圖片</h3><HeroImageFieldset draft={draft} image={image} allowImageOnly={pageName==='index'} onChange={(changes,removeEmbedded)=>patchImage(draft.uid,changes,removeEmbedded)}/></div>:null}
      {allowEntities?<div className="scope-editor-stage">
        <h3 className="scope-editor-stage__title">附屬內容</h3>
        <label className="scope-bubble-layout-control">文字泡泡排列（每列）
          <select className="scope-select" value={draft.bubbleColumns} onChange={e=>patchDraft(draft.uid,{bubbleColumns:Number(e.target.value)})}>
            {[2,3,6].map(n=><option key={n} value={n}>{n} 個</option>)}
          </select>
        </label>
        {renderDraftEntities(draft)}
      </div>:null}
    </section>;
  }

  dockActions.current={
    save,isDirty:()=>JSON.stringify(drafts)!==initialDrafts.current,
    isBusy:()=>busy,discard:onCancel
  };
  useEffect(()=>{
    onDirtyChange?.(JSON.stringify(drafts)!==initialDrafts.current);
    return ()=>onDirtyChange?.(false);
  },[drafts,onDirtyChange]);

  useEffect(()=>{
    // Admin can also be opened directly, without homepage Edit mode.
    // Mounted drafts still participate in the same unsaved-change guard.
    if(!editDock?.register)return undefined;
    return editDock.register({
      save:options=>dockActions.current.save(options),
      discard:()=>dockActions.current.discard(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[editDock?.register]);

  const visibleDrafts=drafts.filter(draft=>!draft._deleted);
  return <>
    <div className="scope-block-draft-toolbar">
      {toolbar}
      {!inDock?<div className="scope-block-draft-actions">
        <button type="button" className="loc-button primary" disabled={busy} onClick={save}>{busy?t('uiExtra.editBlocks.saving'):t('uiExtra.editBlocks.save')}</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>{if(window.confirm(t('uiExtra.editBlocks.cancelConfirm')))onCancel();}}><UiText id="uiExtra.editBlocks.cancel"/></button>
      </div>:null}
    </div>
    {visibleDrafts.map((draft,index)=>renderDraft(draft,index,visibleDrafts))}
    {canAddBlock?<button type="button" className="loc-button scope-add-page-block" onClick={addBlock} disabled={busy}><UiText id="uiExtra.editBlocks.addBlock"/></button>:null}
    {message?<p className={'scope-status'+(message.startsWith(t('uiExtra.editBlocks.saveFailedPrefix'))?' scope-error':'')} role="status">{message}</p>:null}
  </>;
}
