'use client';
import {parseBlockImage} from './hero-image.mjs';
import UiText from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import editBlocksZh from '../i18n/sections/uiExtra.editBlocks.zh_tw.js';
registerDefaultSection('uiExtra.editBlocks',editBlocksZh);

import {useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {useEditDock} from '../modular/edit-dock';
import {navigationHref} from '../modular/scope-registry';
import useNativeNavigation from '../modular/use-native-navigation';
import dynamic from 'next/dynamic';
import {useAppBootstrap} from './app-bootstrap';
import {useAccount} from './use-account';
// Read-only home blocks must not eagerly import editor UI or BlockNote.
const ScopeBlockEditorSession=dynamic(()=>import('./ScopeBlockEditorSession'),{loading:()=>null});
const ScopeBlockDraftList=dynamic(()=>import('./ScopeBlockDraftList'),{loading:()=>null});
import {isInteractiveContentTarget} from './content-policy.js';

import {HomeBlock} from './home-block-model';
import {BlockNoteContent} from './blocknote-content.mjs';

function pageNameOf(value='index'){
  const page=String(value||'index').trim().toLowerCase();
  return page==='home'?'index':page;
}

function normalizeRow(row,order,pageName='index'){
  return {
    uid:String(row?.uid||''),
    stored:Boolean(row?.uid),
    order:Number(row?.block_order||order||1),
    eyebrow:String(row?.block_eyebrow||''),
    title:String(row?.block_title||''),
    subtitle:String(row?.block_subtitle||''),
    text:HomeBlock.removeDuplicatedLegacySubtitle(row?.block_text,row?.block_subtitle),
    image:parseBlockImage(row?.block_image),
    bubbleColumns:HomeBlock.bubbleColumns(row?.block_entity,pageName),
    entities:HomeBlock.normalizeEntities(row?.block_entity)
  };
}

export default function ScopeEditableBlocks({
  scopeId,
  page='index',
  orders=null,
  className='',
  slotClassName='loc-card',
  editSlotClassName='',
  headingLevel=3,
  renderDisplay=null,
  resolveSlotClassName=null,
  resolveSlotStyle=null,
  maxBlocks=null,
  placeholderFirstOrder=null,
  containerless=false,
  allowEditing=true,
  adminOnly=false,
  allowDelete=true,
  allowEntities=true,
  allowInlineChildAdd=false,
  explicitEditButton=false,
  // Only a separately authenticated management page may set these two options.
  // The actual write is still checked by the database.
  authorizedByParent=false,
  startInEditMode=false,
  keepEditorOpen=false,
  onDirtyChange=null,
  onEditorExit=null,
  toggleExtra=null,
  onSuggestionClick=null,
  allowImages=true,
  editEyebrow=true,
  slotTag='section',
  slotId=''
}){
  useUiSection('uiExtra.editBlocks');
  const reduceMotion=useReducedMotion();
  const pageName=pageNameOf(page);
  const isScopeHomepageBlock=pageName==='index'||(scopeId==='lrunes'&&pageName==='hero');
  // Public blocks must not preflight silver.loc; protected parent workspaces
  // already share the verified account cache when edit controls render.
  const account=useAccount({enabled:false});
  const editDock=useEditDock();
  const native=useNativeNavigation();
  // Shares AppShell's (scopeId, pageName) query, which reuses the global
  // Registry/Theme snapshot and loads only this Scope's page blocks.
  const bootstrap=useAppBootstrap(scopeId,pageName);
  const blocks=bootstrap.data?.blocks;
  // The Scope-specific homepage entry has already verified access.
  // Database authorization remains mandatory on every write.
  const homeEditActive=isScopeHomepageBlock&&editDock?.active&&editDock.scopeId===scopeId;
  // A cached management role must not enable homepage editing until the
  // user explicitly enters this Scope's edit mode.
  const canEdit=allowEditing&&(authorizedByParent||
    (isScopeHomepageBlock?homeEditActive:
      ((adminOnly||scopeId==='loc')?account.canManageGlobalSync():account.canManageScopeSync(scopeId))));
  const normalizedOrders=useMemo(
    ()=>Array.isArray(orders)?orders.map(Number).filter(value=>Number.isInteger(value)&&value>0):[],
    [orders]
  );
  const [editingSlot,setEditingSlot]=useState(null);
  const [message,setMessage]=useState('');
  const [editMode,setEditMode]=useState(Boolean(startInEditMode));

  const slots=useMemo(()=>{
    const rows=Array.isArray(blocks)?blocks:[];
    if(normalizedOrders.length){
      const byOrder=new Map(rows.map(row=>[Number(row.block_order),row]));
      return normalizedOrders.map(order=>normalizeRow(byOrder.get(order),order,pageName));
    }
    if(Number.isInteger(maxBlocks)&&maxBlocks>0){
      const displayed=HomeBlock.rows(rows,pageName,maxBlocks).map(row=>normalizeRow(row,row.block_order,pageName));
      if(editingSlot&&!editingSlot.stored&&!displayed.some(slot=>slot.order===editingSlot.order)&&editingSlot.order<=maxBlocks){
        displayed.push({...editingSlot});
      }
      if(Number.isInteger(placeholderFirstOrder)&&placeholderFirstOrder>0&&placeholderFirstOrder<=maxBlocks
          &&!displayed.some(slot=>slot.order===placeholderFirstOrder)){
        displayed.push(normalizeRow(null,placeholderFirstOrder,pageName));
      }
      displayed.sort((a,b)=>a.order-b.order);
      return displayed;
    }
    const displayed=rows.map(row=>normalizeRow(row,row.block_order,pageName));
    // Unbounded pages must render the unsaved editingSlot, or the Add Block button appears inert.
    if(editingSlot&&!editingSlot.stored&&!displayed.some(slot=>slot.order===editingSlot.order)){
      displayed.push({...editingSlot});
      displayed.sort((a,b)=>a.order-b.order);
    }
    return displayed;
  },[blocks,normalizedOrders,maxBlocks,pageName,editingSlot,placeholderFirstOrder]);
  const nextOrder=useMemo(()=>{
    const rows=Array.isArray(blocks)?blocks:[];
    return Math.max(0,...rows.map(row=>Number(row.block_order)||0))+1;
  },[blocks]);


  function begin(slot){
    if(!canEdit)return;
    setEditingSlot({...slot,uid:slot.uid||HomeBlock.createUid(),
      entities:HomeBlock.normalizeEntities(slot.entities)});
    setMessage('');
  }
  function beginWithChild(slot){
    if(!canEdit||!allowEntities)return;
    const entities=HomeBlock.normalizeEntities(slot.entities);
    if(entities.length>=HomeBlock.entityLimit)return;
    setEditingSlot({...slot,uid:slot.uid||HomeBlock.createUid(),
      entities:[...entities,{uid:HomeBlock.createUid(),title:'',text:'',order:entities.length+1}]});
    setMessage('');
  }
  function cancel(){setEditingSlot(null);setMessage('');}
  function recommendationTerm(raw){
    // Multi-paragraph editor content may contain descriptions after the keyword.
    const html=String(raw||'').replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n');
    return BlockNoteContent.text.blocksToPlainText(html).split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'';
  }
  function selectSuggestion(text){
    if(typeof onSuggestionClick==='function'){
      const term=recommendationTerm(text);
      if(term)onSuggestionClick(term);
    }
  }
  function renderEntities(entities,bubbleColumns){
    // In suggestion mode, a viewer who cannot edit should only ever see
    // entities that actually have a clickable term; editors still see every
    // entity (including empty ones) so they can fill them in.
    const visibleEntities=onSuggestionClick&&!canEdit
      ?entities.filter(entity=>recommendationTerm(entity.text))
      :entities;
    if(!visibleEntities.length)return null;
    return <div className="scope-block-entity-grid" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([bubbleColumns],pageName)}}>
      {visibleEntities.map(entity=><article
        className={HomeBlock.childPresentation(entity.title)==='card'?'scope-block-entity':'loc-bubble scope-block-text-bubble'}
        key={entity.uid}
        role={onSuggestionClick?'link':undefined}
        tabIndex={onSuggestionClick?0:undefined}
        onKeyDown={onSuggestionClick?event=>{if(event.key==='Enter'&&!isInteractiveContentTarget(event.target,event.currentTarget)){event.stopPropagation();selectSuggestion(entity.text);}}:undefined}
        onClick={onSuggestionClick?event=>{if(!isInteractiveContentTarget(event.target,event.currentTarget)){event.stopPropagation();selectSuggestion(entity.text);}}:undefined}>
        {HomeBlock.childPresentation(entity.title)==='card'?<h4>{entity.title}</h4>:null}
        {entity.text?<div className="scope-rich-surface" dangerouslySetInnerHTML={{__html:entity.text}}/>:null}
      </article>)}
    </div>;
  }
  const movableSlots=!normalizedOrders.length&&allowDelete?slots.filter(slot=>slot.stored):[];
  const SlotTag=slotTag==='header'?'header':'section';
  // Only the published LOC/Author homepage receives motion. The unified
  // BlockNote draft view remains exactly as before, with no animated ancestors.
  const motionHome=pageName==='index'&&['loc','lo3rwang'].includes(scopeId)&&SlotTag==='section';
  const HomeDisplayTag=motionHome?motion.section:SlotTag;
  const homeMotionProps=slot=>!motionHome?{}:{
    initial:reduceMotion?false:{opacity:slot.order===1?.92:.9,y:slot.order===1?14:10},
    ...(slot.order===1
      ?{animate:{opacity:1,y:0}}
      :{whileInView:{opacity:1,y:0},viewport:{once:true,amount:.12}}),
    transition:{duration:reduceMotion?0:slot.order===1?.58:.4,
      delay:reduceMotion?0:slot.order===1?.04:Math.min(Math.max(slot.order-2,0)*.045,.18),
      ease:[.22,.8,.22,1]}
  };

  // explicitEditButton: one page-level toggle swaps the whole list for the
  // unified draft screen -- no per-block click target, no per-block button.
  if(explicitEditButton){
    const canAddBlock=!normalizedOrders.length&&(!maxBlocks||nextOrder<=maxBlocks);
    const editing=editMode||homeEditActive;
    const toggleButton=(canEdit&&!editing)||toggleExtra?<div className="scope-edit-mode-toggle" key="scope-edit-mode-toggle">
      {canEdit&&!editing?<button type="button" className="loc-button" onClick={()=>setEditMode(true)}>
        <UiText id="uiExtra.editBlocks.enterEditMode"/>
      </button>:null}
      {toggleExtra}
    </div>:null;
    const heroSlotOrder=Number.isInteger(placeholderFirstOrder)&&placeholderFirstOrder>0?placeholderFirstOrder:null;
    const contents=<>
      {!editing&&!heroSlotOrder?toggleButton:null}
      {editing&&!bootstrap.isSuccess?<p className="scope-status" role="status">
        {bootstrap.isError?'搜尋建議載入失敗。':'正在載入搜尋建議…'}
      </p>:null}
      {editing&&bootstrap.isSuccess?<ScopeBlockDraftList
        slots={slots}
        scopeId={scopeId}
        pageName={pageName}
        allowDelete={allowDelete}
        allowEntities={allowEntities}
        allowImages={allowImages}
        editEyebrow={editEyebrow}
        canAddBlock={canAddBlock}
        slotClassName={slotClassName}
        editSlotClassName={editSlotClassName}
        preserveOrder={Boolean(normalizedOrders.length)}
        toolbar={toggleButton}
        onDirtyChange={onDirtyChange}
        onCancel={()=>{
          if(keepEditorOpen){onEditorExit?.();return;}
          setEditMode(false);
          if(editDock?.active&&editDock.scopeId===scopeId){
            const destination=pageName==='search'?'search':pageName==='trace'?'search':'';
            editDock.complete(navigationHref(scopeId,destination,native));
          }else onEditorExit?.();
        }}
        onDone={(notice,{switching=false}={})=>{
          setMessage(notice);
          // Real Save never tears down an active Edit Dock or reloads the homepage.
          // Page switching/canceling remains the Dock's explicit responsibility.
          if(editDock?.active&&editDock.scopeId===scopeId){
            if(keepEditorOpen&&!switching)onEditorExit?.(notice);
            return;
          }
          if(keepEditorOpen){if(!switching)onEditorExit?.(notice);return;}
          if(['search','trace'].includes(pageName)&&!switching)return;
          setEditMode(false);
          if(switching)return;
          if(editDock?.active&&editDock.scopeId===scopeId)
            editDock.complete(navigationHref(scopeId,'',native));
          else onEditorExit?.(notice);
        }}
      />:slots.flatMap((slot,index)=>{
        const empty=!BlockNoteContent.text.hasBlockNoteFrameContent(slot);
        if(empty&&!canEdit&&slot.order!==placeholderFirstOrder)return [];
        if(onSuggestionClick&&!canEdit
            &&!recommendationTerm(slot.text)
            &&!recommendationTerm(slot.subtitle)
            &&!slot.entities.some(entity=>recommendationTerm(entity.text)))return [];
        const level=Number(headingLevel);
        const Heading=level===1?'h1':level===2?'h2':level===4?'h4':'h3';
        const node=<HomeDisplayTag
          {...homeMotionProps(slot)}
          id={slotId||undefined}
          className={(typeof resolveSlotClassName==='function'?resolveSlotClassName(slot):slotClassName)+' scope-editable-block'+(empty?' is-empty':'')+(motionHome?' loc-home-motion-block':'')}
          style={typeof resolveSlotStyle==='function'?resolveSlotStyle(slot):undefined}
          key={slot.uid||'order:'+slot.order}
          data-page-name={pageName}
          data-block-order={slot.order}
          onClick={onSuggestionClick&&!slot.entities.some(entity=>recommendationTerm(entity.text))
          ?event=>{if(!isInteractiveContentTarget(event.target))selectSuggestion(slot.text||slot.subtitle||slot.title)}
          :undefined}
        >
          {motionHome&&slot.order===1&&!empty?<motion.span className="loc-home-motion-hero-line"
            aria-hidden="true" initial={reduceMotion?false:{scaleX:0}} animate={{scaleX:1}}
            transition={{duration:reduceMotion?0:.85,delay:reduceMotion?0:.16,ease:[.22,.8,.22,1]}}/>:null}
          {typeof renderDisplay==='function'
            ?renderDisplay(slot)
            :<>
              {slot.eyebrow?<p className="loc-eyebrow">{slot.eyebrow}</p>:null}
              {slot.title?<Heading>{slot.title}</Heading>:null}
              {slot.subtitle?<p className="loc-subtitle scope-block-subtitle">{HomeBlock.plainBlockLine(slot.subtitle)}</p>:null}
              {slot.text?<div className="scope-rich-surface" dangerouslySetInnerHTML={{__html:slot.text}}/>:null}
              {renderEntities(slot.entities,slot.bubbleColumns)}
            </>}
        </HomeDisplayTag>;
        return heroSlotOrder&&slot.order===heroSlotOrder?[node,toggleButton]:[node];
      })}
      {!editing&&message?<p className="scope-status" role="status">{message}</p>:null}
    </>;
    return containerless?contents:<div className={'scope-editable-block-grid '+className}>{contents}</div>;
  }

  const contents=<>
    {slots.map(slot=>{
      const active=editingSlot?.uid&&(editingSlot.uid===slot.uid||(!slot.stored&&editingSlot.order===slot.order));
      const movableIndex=movableSlots.findIndex(item=>item.uid===slot.uid);
      const empty=!BlockNoteContent.text.hasBlockNoteFrameContent(slot);
      if(empty&&!canEdit&&slot.order!==placeholderFirstOrder)return null;
      // A Search suggestion needs an actual clickable term, not just its
      // section heading. Editors always retain their block and edit action.
      if(onSuggestionClick&&!canEdit&&!active
          &&!recommendationTerm(slot.text)
          &&!recommendationTerm(slot.subtitle)
          &&!slot.entities.some(entity=>recommendationTerm(entity.text)))return null;
      const level=Number(headingLevel);
      const Heading=level===1?'h1':level===2?'h2':level===4?'h4':'h3';
      return <SlotTag
        id={slotId||undefined}
        className={((active&&editSlotClassName)?editSlotClassName:(typeof resolveSlotClassName==='function'?resolveSlotClassName(slot):slotClassName))+' scope-editable-block'+(active?' is-editing':'')+(canEdit&&!active?' is-editable-idle':'')+(empty?' is-empty':'')}
        key={slot.uid||'order:'+slot.order}
        data-page-name={pageName}
        data-block-order={slot.order}
        onClickCapture={canEdit&&!active?event=>{if(!isInteractiveContentTarget(event.target))begin(slot)}:undefined}
        onClick={!active&&onSuggestionClick&&!slot.entities.some(entity=>recommendationTerm(entity.text))
          ?event=>{if(!isInteractiveContentTarget(event.target))selectSuggestion(slot.text||slot.subtitle||slot.title)}
          :undefined}
      >
        {active?<ScopeBlockEditorSession
          key={editingSlot.uid}
          initial={editingSlot}
          slot={slot}
          scopeId={scopeId}
          pageName={pageName}
          movableSlots={movableSlots}
          movableIndex={movableIndex}
          normalizedOrders={normalizedOrders}
          allowDelete={allowDelete}
          allowEntities={allowEntities}
          allowImages={allowImages}
          editEyebrow={editEyebrow}
          onClose={cancel}
          onDone={notice=>{setEditingSlot(null);setMessage(notice)}}
        />:<>
          {typeof renderDisplay==='function'
            ?renderDisplay(slot)
            :<>
              {slot.eyebrow?<p className="loc-eyebrow">{slot.eyebrow}</p>:null}
              {slot.title?<Heading>{slot.title}</Heading>:null}
              {slot.subtitle?<p className="loc-subtitle scope-block-subtitle">{HomeBlock.plainBlockLine(slot.subtitle)}</p>:null}
              {slot.text?<div className="scope-rich-surface" dangerouslySetInnerHTML={{__html:slot.text}}/>:null}
              {renderEntities(slot.entities,slot.bubbleColumns)}
            </>}
          {canEdit&&allowEntities&&allowInlineChildAdd&&slot.entities.length<HomeBlock.entityLimit?<button
            type="button"
            className="loc-button scope-search-add-child"
            onClick={()=>beginWithChild(slot)}
            disabled={Boolean(editingSlot)}
          ><UiText id="uiExtra.editBlocks.addChild"/></button>:null}
          {empty&&canEdit?<p className="scope-status"><UiText id="uiExtra.editBlocks.clickToCreate"/></p>:null}
        </>}
      </SlotTag>;
    })}
    {canEdit&&!normalizedOrders.length&&(!maxBlocks||nextOrder<=maxBlocks)?<button
      type="button"
      className="loc-button scope-add-page-block"
      onClick={()=>begin(normalizeRow(null,nextOrder,pageName))}
      disabled={Boolean(editingSlot)}
    ><UiText id="uiExtra.editBlocks.addBlock"/></button>:null}
    {message?<p className="scope-status" role="status">{message}</p>:null}
  </>;
  return containerless?contents:<div className={'scope-editable-block-grid '+className}>{contents}</div>;
}
