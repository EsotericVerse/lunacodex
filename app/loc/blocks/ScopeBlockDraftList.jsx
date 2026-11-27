'use client';

import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {scrollHomeTop,turnHomeBlocks} from './home-page-turn.mjs';
import {useEditDock} from '../../modular/edit-dock';
import {editorTransactionLease,assertEditorTransactionLease,isEditorTransactionCancelled} from '../db/editor-transaction-lifecycle.mjs';
import dynamic from 'next/dynamic';
import {useQueryClient} from '../../../packages/zenstack/client-queries';
import UiText,{useUiText} from '../../i18n/UiText';
import FieldText from '../../i18n/FieldText';
import {useUiSection} from '../../i18n/ui-locale';
import {HomeBlock} from './home-block-model';
import {BlockNoteContent} from '../editor/blocknote-content.mjs';
import {resolveHomeImage} from './LocHomeBlockDisplay';
import {isHomeFrameFor} from './hero-image.mjs';
import {blockWritePermissionKey,scopeBlockStoragePage} from './scope-block-storage-page.mjs';
import {HeroImageFieldset} from './HeroImageFields';
import {invalidateScopeBlockPage} from '../scope/scope-data';
import {planHomeBlockWrites} from './home-block-draft-plan.mjs';
import ManagementVisNetwork from '../../modular/ManagementVisNetwork';

const BlockNoteEditor=dynamic(()=>import('../editor/BlockNoteEditor'),{loading:()=>null});
const ObjectEditor=dynamic(()=>import('../editor/BlockNoteEditor').then(mod=>mod.ObjectEditor),{loading:()=>null});

const TITLE_LIMIT=64;
const EYEBROW_LIMIT=64;
const SUBTITLE_LIMIT=128;

function stripInlineImage(value){
  return String(value||'').replace(/<img\b[^>]*>/gi,'');
}

export default function ScopeBlockDraftList({
  slots,scopeId,pageName,allowDelete=true,allowEntities=true,allowImages=true,
  editEyebrow=true,canAddBlock=false,slotClassName='loc-card',editSlotClassName='',
  preserveOrder=false,toolbar=null,onDone,onCancel,onDirtyChange=null,
  previewDisplay:PreviewDisplay=null,previewClassName=null,previewStyle=null
}){
  useUiSection('uiExtra.editBlocks');
  useUiSection('uiExtra.frameEditor');
  const t=useUiText();
  const reduceMotion=useReducedMotion();
  const queryClient=useQueryClient();
  const editDock=useEditDock();
  const storagePage=scopeBlockStoragePage(scopeId,pageName);
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
  const visibleDrafts=useMemo(()=>drafts.filter(draft=>!draft._deleted),[drafts]);
  const [activeTarget,setActiveTarget]=useState(()=>slots[0]?.uid?'block:'+slots[0].uid:'');
  const [networkState,setNetworkState]=useState('loading');
  const activeBlockUid=activeTarget.startsWith('entity:')
    ?activeTarget.split(':')[1]||''
    :activeTarget.startsWith('block:')?activeTarget.slice(6):'';
  const activeDraft=visibleDrafts.find(draft=>draft.uid===activeBlockUid)||null;
  const blockGraph=useMemo(()=>{
    const center=(visibleDrafts.length-1)/2;
    const rootId='home:'+scopeId+':'+pageName;
    const pageRoot=pageName==='index';
    const nodes=[{id:rootId,label:pageRoot?'首頁':'頁面',level:0,x:0,y:0,fixed:true,
      widthConstraint:{maximum:150}}];
    const edges=[];
    const selectedEntities=activeDraft?.entities||[];
    visibleDrafts.forEach((draft,index)=>{
      const blockId='block:'+draft.uid;
      const y=(index-center)*112;
      nodes.push({id:blockId,label:String(draft.title||draft.eyebrow||'區塊 '+(index+1)),
        level:1,x:220,y,fixed:true,widthConstraint:{maximum:190}});
      edges.push({id:rootId+'>'+blockId,from:rootId,to:blockId});
      if(draft.uid!==activeDraft?.uid)return;
      const childCenter=(selectedEntities.length-1)/2;
      selectedEntities.forEach((entity,entityIndex)=>{
        const entityId='entity:'+draft.uid+':'+entity.uid;
        const body=BlockNoteContent.text.blocksToPlainText(entity.text||'').trim();
        nodes.push({id:entityId,
          label:String(entity.title||body.split(/\r?\n/)[0]||'子內容 '+(entityIndex+1)).slice(0,48),
          level:2,x:475,y:y+(entityIndex-childCenter)*64,fixed:true,
          widthConstraint:{maximum:210}});
        edges.push({id:blockId+'>'+entityId,from:blockId,to:entityId});
      });
    });
    return {nodes,edges,rootId};
  },[visibleDrafts,activeDraft,scopeId,pageName]);
  useEffect(()=>{
    if(!visibleDrafts.length){if(activeTarget)setActiveTarget('');return;}
    if(!activeDraft){setActiveTarget('block:'+visibleDrafts[0].uid);return;}
    if(activeTarget.startsWith('entity:')){
      const entityUid=activeTarget.split(':')[2]||'';
      if(!activeDraft.entities.some(entity=>entity.uid===entityUid))
        setActiveTarget('block:'+activeDraft.uid);
    }
  },[visibleDrafts,activeDraft,activeTarget]);
  const [preview,setPreview]=useState(false);
  const [requestedPreview,setRequestedPreview]=useState(false);
  const turning=Boolean(PreviewDisplay&&requestedPreview!==preview);
  useLayoutEffect(()=>{
    if(!turning)return;
    scrollHomeTop();
    return turnHomeBlocks(requestedPreview?'preview':'edit',()=>setPreview(requestedPreview),scopeId);
  },[turning,requestedPreview,scopeId]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const mounted=useRef(false);
  useLayoutEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);

  async function publishSavedBlocks(rows){
    // The rows were committed by SQL. Update the active viewer from those exact
    // saved values: do not start two independent SELECTs on every Dock Save.
    // Future visits read the live provider; mounted public readers adopt the saved rows.
    invalidateScopeBlockPage(scopeId,pageName);
    await queryClient.setQueryData(['scope-blocks',scopeId,pageName],rows);
    await queryClient.setQueryData(['scope-public-blocks',scopeId,pageName],rows);
    if(scopeId==='loc'&&/^(group|scope)_/.test(pageName))
      await queryClient.invalidateQueries({queryKey:['scope-public-hero',pageName.replace(/^(group|scope)_/,'')]});
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
    const childUid=HomeBlock.createUid();
    setActiveTarget('entity:'+uid+':'+childUid);
    setDrafts(current=>current.map(draft=>{
      if(draft.uid!==uid||draft.entities.length>=HomeBlock.entityLimit)return draft;
      return {...draft,entities:[...draft.entities,{uid:childUid,title:'',text:'',order:draft.entities.length+1}]};
    }));
  }
  function removeEntity(uid,index){
    if(activeTarget.startsWith('entity:'+uid+':'))setActiveTarget('block:'+uid);
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
    if(activeBlockUid===uid){
      const next=visibleDrafts.find(draft=>draft.uid!==uid);
      setActiveTarget(next?'block:'+next.uid:'');
    }
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
    const uid=HomeBlock.createUid();
    setActiveTarget('block:'+uid);
    setDrafts(current=>{
      const nextOrder=Math.max(0,...current.map(draft=>Number(draft.order)||0))+1;
      return [...current,{
        uid,stored:false,order:nextOrder,
        eyebrow:'',title:'',subtitle:'',text:'',image:null,entities:[],bubbleColumns:HomeBlock.defaultBubbleColumns(pageName),_deleted:false
      }];
    });
  }

  async function save({switching=false}={}){
    if(busy)return false;
    const lease=editorTransactionLease();
    const current=()=>mounted.current&&!isEditorTransactionCancelled(lease);
    if(!current())return false;
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
      const {dbAuthClient}=await import('../db/db-client.mjs');
      if(!current())return false;
      assertEditorTransactionLease(lease);
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
      let refreshWarning='';
      if(plan.hasWrites){
        // Exactly one managed request. Authority is checked once by the server;
        // the entire page commits or rolls back in one transaction.
        const {error,homeCacheSync}=await dbAuthClient.schema('silver').managedAction('save_blocks',{
          p_scope_id:scopeId,p_type:storagePage,p_rows:committedRows
        });
        if(error)throw new Error(error.message||'Blocks 批次儲存失敗');
        if(homeCacheSync===false)
          refreshWarning='SQL 已儲存；R2 首頁副本未重建，目前會回讀 SQL。';
        if(!current())return false;
      }
      // A successful SQL write is final, not a temporary save. Cache updates
      // are local only; failure to update SWR does not undo the database write.
      if(plan.hasWrites){
        try{await publishSavedBlocks(committedRows);}
        catch{refreshWarning=[refreshWarning,'畫面同步失敗，重新整理頁面即可。']
          .filter(Boolean).join('；');}
      }
      if(!current())return false;
      setDrafts(savedDrafts);
      initialDrafts.current=JSON.stringify(savedDrafts);
      onDone(refreshWarning||t('uiExtra.editBlocks.saved'),{switching,committedRows:plan.hasWrites?committedRows:undefined});
      return true;
    }catch(error){
      const permissionKey=blockWritePermissionKey(error,scopeId,pageName);
      const reason=permissionKey?t('uiExtra.editBlocks.'+permissionKey)
        :String(error?.message||error||t('uiExtra.editBlocks.unknown'));
      if(current())report(t('uiExtra.editBlocks.saveFailedPrefix')+reason);
      return false;
    }finally{
      if(mounted.current)setBusy(false);
    }
  }

  function renderDraftEntities(draft){
    const selectedChild=activeTarget.startsWith('entity:'+draft.uid+':')
      ?activeTarget.split(':')[2]||'':'';
    const entities=selectedChild
      ?draft.entities.map((entity,index)=>({entity,index})).filter(row=>row.entity.uid===selectedChild)
      :draft.entities.map((entity,index)=>({entity,index}));
    return <div className="scope-block-entity-grid" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([draft.bubbleColumns],pageName)}}>
      {entities.map(({entity,index})=><article className={HomeBlock.childPresentation(entity.title)==='card'?'scope-block-entity':'loc-bubble scope-block-text-bubble'} key={entity.uid}>
        <div className="scope-block-entity-actions">
          <button type="button" className="loc-button" disabled={index===0||busy} onClick={()=>moveEntity(draft.uid,index,-1)}>←</button>
          <button type="button" className="loc-button" disabled={index===draft.entities.length-1||busy} onClick={()=>moveEntity(draft.uid,index,1)}>→</button>
          <button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>removeEntity(draft.uid,index)}><UiText id="uiExtra.editBlocks.remove"/></button>
        </div>
        <label className="scope-management-wide-field">
          <span><UiText id="common.title"/></span>
          <input className="scope-search-input" value={entity.title}
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
    return <section className={(editSlotClassName||slotClassName)+' scope-editable-block scope-block-draft'+(PreviewDisplay?' loc-home-turn-in-edit':'')}
      style={PreviewDisplay?{'--loc-home-order':index}:undefined} key={draft.uid}>
      <div className="scope-inline-editbar">
        {visibleDrafts.length>1&&!pinnedHero?<button type="button" className="loc-button" disabled={busy||!HomeBlock.canSwapHomeBlockPositions(pageName,visibleDrafts,index,index-1)} onClick={()=>moveBlock(draft.uid,-1)}><UiText id="uiExtra.editBlocks.moveUp"/></button>:null}
        {visibleDrafts.length>1&&!pinnedHero?<button type="button" className="loc-button" disabled={busy||!HomeBlock.canSwapHomeBlockPositions(pageName,visibleDrafts,index,index+1)} onClick={()=>moveBlock(draft.uid,1)}><UiText id="uiExtra.editBlocks.moveDown"/></button>:null}
        {allowDelete?<button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>toggleDelete(draft.uid)}><UiText id="uiExtra.editBlocks.remove"/></button>:null}
      </div>
      <div className="scope-editor-stage"><h3 className="scope-editor-stage__title">文字內容</h3>
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

  useLayoutEffect(()=>{
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

  const showingPreview=Boolean(PreviewDisplay&&preview);
  const previewRows=showingPreview?visibleDrafts.map((draft,index)=>({
    ...draft,pageName,order:preserveOrder?Number(draft.order)||index+1:index+1,
    eyebrow:HomeBlock.plainBlockLine(draft.eyebrow),title:HomeBlock.plainBlockLine(draft.title),
    subtitle:HomeBlock.plainBlockLine(draft.subtitle),
    image:draft.image?.source==='custom'&&!String(draft.image.url||'').trim()
      ?{...draft.image,source:'default',url:''}:draft.image
  })):[];
  return <>
    <div className="scope-block-draft-toolbar">
      {toolbar}
      {PreviewDisplay?<button type="button" className="loc-button" aria-pressed={showingPreview} disabled={busy||turning}
        onClick={()=>setRequestedPreview(value=>!value)}><FieldText text={showingPreview?'返回編輯':'預覽'}/></button>:null}
      {!inDock?<div className="scope-block-draft-actions">
        <button type="button" className="loc-button primary" disabled={busy} onClick={save}>{busy?t('uiExtra.editBlocks.saving'):t('uiExtra.editBlocks.save')}</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>{if(window.confirm(t('uiExtra.editBlocks.cancelConfirm')))onCancel();}}><UiText id="uiExtra.editBlocks.cancel"/></button>
      </div>:null}
    </div>
    {/* Preview owns only the draft values; no hidden BlockNote instances. */}
    {!showingPreview?<div className="loc-home-block-network-editor">
      <aside className="loc-home-block-network-editor__tree" aria-label={pageName==='index'?'首頁內容結構':'頁面內容結構'}>
        <h3 className="loc-home-block-network-editor__title">{pageName==='index'?'首頁結構':'頁面結構'}</h3>
        <ManagementVisNetwork nodes={blockGraph.nodes} edges={blockGraph.edges}
          selectedId={activeTarget.startsWith('entity:')?activeTarget:
            activeDraft?'block:'+activeDraft.uid:''}
          onSelect={id=>{
            if(id.startsWith('block:')||id.startsWith('entity:'))setActiveTarget(id);
          }} ariaLabel="首頁區塊與子內容關係圖"
          onStatusChange={state=>setNetworkState(state)}/>
        {networkState==='loading'?<p className="scope-status" role="status">正在準備首頁結構圖…</p>:null}
        {networkState==='error'?<p className="scope-status scope-error" role="status">圖譜目前無法載入；下方清單仍可切換區塊。</p>:null}
        <details className="loc-home-block-network-editor__choices">
          <summary>區塊與子內容清單</summary>
          <div className="loc-home-block-network-editor__fallback">
            {visibleDrafts.map((draft,index)=><button type="button" key={draft.uid}
              aria-pressed={activeDraft?.uid===draft.uid&&!activeTarget.startsWith('entity:')}
              onClick={()=>setActiveTarget('block:'+draft.uid)}>
              {draft.title||draft.eyebrow||'區塊 '+(index+1)}
            </button>)}
            {activeDraft?.entities.map((entity,index)=><button type="button" key={entity.uid}
              aria-pressed={activeTarget==='entity:'+activeDraft.uid+':'+entity.uid}
              onClick={()=>setActiveTarget('entity:'+activeDraft.uid+':'+entity.uid)}>
              {activeDraft.title||'區塊'} · {entity.title||'子內容 '+(index+1)}
            </button>)}
          </div>
        </details>
      </aside>
      <motion.div layout={!reduceMotion} className="loc-home-block-network-editor__editor"
        transition={reduceMotion?{duration:0}:{layout:{duration:.22,ease:'easeOut'}}}>
        {activeDraft?renderDraft(activeDraft,visibleDrafts.findIndex(draft=>draft.uid===activeDraft.uid),visibleDrafts)
          :<p className="scope-status">目前沒有首頁區塊，請新增區塊開始編輯。</p>}
      </motion.div>
    </div>:null}
    {canAddBlock&&!showingPreview?<button type="button" className="loc-button scope-add-page-block" onClick={addBlock} disabled={busy}><UiText id="uiExtra.editBlocks.addBlock"/></button>:null}
    {showingPreview?previewRows.filter(slot=>BlockNoteContent.text.hasBlockNoteFrameContent(slot)).map((slot,index)=>
      <section key={'preview:'+(slot.uid||'order:'+slot.order)}
        className={(previewClassName?.(slot)||slotClassName)+' scope-editable-block loc-home-motion-block loc-home-turn-in-preview'}
        style={{...(previewStyle?.(slot)||{}),'--loc-home-order':index}}
        onClickCapture={event=>{if(event.target.closest?.('a'))event.preventDefault()}}>
        {slot.order===1?<span className="loc-home-motion-hero-line loc-home-preview-hero-line" aria-hidden="true"/>:null}
        <PreviewDisplay {...slot}/>
      </section>):null}
    {message?<p className={'scope-status'+(message.startsWith(t('uiExtra.editBlocks.saveFailedPrefix'))?' scope-error':'')} role="status">{message}</p>:null}
  </>;
}
