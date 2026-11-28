'use client';

import {WorkSummaryCard} from './ui';
import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import dynamic from 'next/dynamic';
// A plain-text article does not need an editor chunk; edit and rich view mount on demand.
const BlockNoteEditor=dynamic(()=>import('../loc/editor/BlockNoteEditor'),{
  loading:()=> <p className="scope-status" role="status">正在載入文章內容…</p>
});
const ObjectEditor=dynamic(()=>import('../loc/editor/BlockNoteEditor').then(mod=>mod.ObjectEditor),{loading:()=>null});
import {UI_COPY} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import UiText,{useUiText} from '../i18n/UiText';
import {isInteractiveContentTarget} from '../loc/content/content-policy.js';


// The existing BlockNote read-only canvas is needed only once a rich-text
// result is close to the viewport. Off-screen search results stay unmounted,
// including editor setup and HTML parsing, until a reader scrolls near them.
function DeferredArticleBody({html}){
  const [visible,setVisible]=useState(false);
  const reduceMotion=useReducedMotion();
  const container=useRef(null);
  useEffect(()=>{
    const node=container.current;
    if(!node)return;
    if(typeof IntersectionObserver==='undefined'){
      setVisible(true);
      return;
    }
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){
        setVisible(true);
        observer.disconnect();
      }
    },{rootMargin:'240px 0px'});
    observer.observe(node);
    return ()=>observer.disconnect();
  },[]);
  return <div ref={container} className="scope-article-block-display"
    role="region" aria-label={UI_COPY.common.body}
    style={!visible?{minHeight:'3rem'}:undefined}>
    {visible?<motion.div
      initial={reduceMotion?false:{opacity:0,y:4}}
      animate={{opacity:1,y:0}}
      transition={reduceMotion?{duration:0}:{duration:.18,ease:'easeOut'}}>
      <BlockNoteEditor editable={false} initialContent={html}/>
    </motion.div>:null}
  </div>;
}

// Shared article(uid) list module for Search and Culture.
export default function Article({uid,title,articleHref='',detailReading=false,relatedMedia=[],relatedTime=null,relatedSpace=null,relatedStatistics=null,articleScopeId='',articleDate='',articleCreateTime='',tracePlace=null,traceHref='',locationName='',source='',scopeId='',date='',checkInPlace='',body='',hidden=false,relationLinks=[],links=[],destinations=[],editable=false,editing=false,onEdit,editorDraft=null,onDraftChange,onSave,onDelete,onCancel,editBusy=false,editError='',showHidden=false,attributeFields=null,styleTag=false,styleTagKicker=null,styleIntroText='',children=null,showBodyEditor=true,attributeTitle='',mediaScopeId='',editOnCardClick=true,managerMode=false,showInlineEditorActions=true}){
  useUiSection('uiExtra.searchUI');
  useUiSection('uiExtra.editBlocks');
  const t=useUiText();
  const richBody=typeof body==='string'&&/<[a-z][^>]*>/i.test(body);
  // A full article is a BlockNote document even when its stored content is
  // legacy plain text. Compact list summaries retain their original text path.
  const documentBody=Boolean(body)&&(detailReading||richBody);
  const onClickCapture=editOnCardClick&&editable&&!editing&&typeof onEdit==='function'?event=>{
    if(!isInteractiveContentTarget(event.target))onEdit(uid);
  }:undefined;
  const editingReady=editing&&Boolean(editorDraft);
  const editorActions=editingReady&&showInlineEditorActions?<ObjectEditor mode="actions" actionClassName="scope-article-editor-actions"
    actions={[
      {key:'save',primary:true,disabled:editBusy,onClick:onSave,label:editBusy?UI_COPY.common.saving:UI_COPY.common.save},
      ...(editable&&onDelete?[{key:'delete',danger:true,disabled:editBusy,onClick:onDelete,label:<UiText id="uiExtra.editBlocks.remove"/>}]:[]),
      {key:'cancel',disabled:editBusy,onClick:onCancel,label:UI_COPY.common.cancel}
    ]} status={editError} statusClassName="scope-error" statusRole="alert"/>:null;
  const titleEditor=editingReady?<input className="scope-article-edit-title" aria-label={UI_COPY.common.title} value={editorDraft.title||''} onChange={event=>onDraftChange(current=>({...current,title:event.target.value}))}/>:null;
  // Use the existing list row date without fetching its article body.
  const displayDate=String(date||articleDate||articleCreateTime||'').slice(0,10);
  return <WorkSummaryCard title={title} titleHref={articleHref} titleEditor={titleEditor} kicker={styleTag?styleTagKicker:null} source={source} scopeId={scopeId} date={editingReady?'':displayDate} actions={editorActions}
    body={editingReady||documentBody||styleTag?'':body} hidden={hidden} relationLinks={relationLinks} detailReading={detailReading} relatedMedia={relatedMedia} relatedTime={relatedTime} relatedSpace={relatedSpace} relatedStatistics={relatedStatistics} articleScopeId={articleScopeId} articleDate={articleDate} articleCreateTime={articleCreateTime} tracePlace={tracePlace} traceHref={traceHref} locationName={locationName} links={links}
    destinations={destinations} className={['loc-shared-work-card',styleTag?'scope-article-style-tag-hit':'',detailReading?'scope-article-detail':''].filter(Boolean).join(' ')} onClickCapture={onClickCapture}>
    {styleTag&&!editingReady&&styleIntroText?<div className="scope-style-tag-search-intro">{styleIntroText}</div>:null}
    {documentBody&&!editingReady?<DeferredArticleBody html={body}/>:null}
    {editingReady?<ObjectEditor mode="article" draft={editorDraft} onChange={onDraftChange} showHidden={showHidden} attributeFields={attributeFields} showBodyEditor={showBodyEditor} attributeTitle={attributeTitle} mediaHref={mediaScopeId?mediaEditHref:null}/>:null}
    {children}
  </WorkSummaryCard>;
}
