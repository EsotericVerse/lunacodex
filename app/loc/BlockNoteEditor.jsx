'use client';

import dynamic from 'next/dynamic';
import {Fragment} from 'react';
import {UI_COPY,registerDefaultSection} from '../i18n/ui-copy';
import {useUiSection} from '../i18n/ui-locale';
import {useUiText} from '../i18n/UiText';
import searchUIZh from '../i18n/sections/uiExtra.searchUI.zh_tw.js';
registerDefaultSection('uiExtra.searchUI',searchUIZh);
import {blocksToPlainText,looksLikeMarkdown,normalizeBlocks,plainTextToBlocks} from './blocknote-content.mjs';
import ScopeLink from '../modular/ScopeLink';

// BlockNote itself is browser-only; keep this as the single public editor entrypoint.
const BlockNoteCanvas=dynamic(()=>import('./BlockNoteEditorClient'),{
  ssr:false,
  loading:()=>null
});

export default function BlockNoteEditor({
  editorKey,
  initialContent,
  content,
  editable=true,
  onChange=null,
  onBlocksChange=null,
  onPlainTextChange=null,
  onHtmlChange=null,
  canInsertImage=true,
  suggestionKind='',
  suggestions=[],
  plainTextOnly=false,
  ariaLabel='文字編輯器',
  className=''
}){
  const source=initialContent===undefined?content:initialContent;
  // Plain descriptions must keep literal angle-bracket text, not parse it as HTML.
  const normalized=plainTextOnly
    ?plainTextToBlocks(typeof source==='string'?source:blocksToPlainText(source))
    :normalizeBlocks(source);
  const initialBlocks=Array.isArray(normalized)?normalized:plainTextToBlocks('');
  const initialHtml=Array.isArray(normalized)?'':String(normalized?.html||'');
  const initialMarkdown=!plainTextOnly&&!initialHtml&&looksLikeMarkdown(source)?String(source):'';
  const handleChange=blocks=>{
    onChange?.(blocks);
    onBlocksChange?.(blocks);
    onPlainTextChange?.(blocksToPlainText(blocks));
  };
  return <div className={'scope-blocknote '+(editable?'is-editable ':'is-readonly ')+(plainTextOnly?'is-plain-text ':'')+className}>
    <BlockNoteCanvas
      key={editorKey}
      initialBlocks={initialBlocks}
      initialHtml={initialHtml}
      initialMarkdown={initialMarkdown}
      editable={editable}
      onChange={onChange||onBlocksChange||onPlainTextChange?handleChange:null}
      onHtmlChange={onHtmlChange}
      canInsertImage={canInsertImage&&!plainTextOnly}
      suggestionKind={suggestionKind}
      suggestions={suggestions}
      plainTextOnly={plainTextOnly}
      ariaLabel={ariaLabel}
    />
  </div>;
}

/**
 * One configurable editing surface. Schema/Scope-specific persistence stays
 * with its existing parent; form rendering and BlockNote stay here.
 */
export function ObjectEditor({
  mode='article',
  draft=null,
  onChange=null,
  fields=[],
  showHidden=false,
  attributeFields=null,
  showBodyEditor=true,
  attributeTitle='',
  mediaHref=null,
  actions=[],
  actionClassName='scope-inline-editbar',
  status='',
  statusClassName='',
  statusRole='status'
}){
  useUiSection('uiExtra.searchUI');
  const t=useUiText();
  const actionBar=actions.length||status?<div className={actionClassName}>
    {actions.map(action=><button key={action.key} type="button"
      className={'loc-button'+(action.primary?' primary':'')+(action.danger?' scope-danger-button':'')}
      disabled={action.disabled===true} onClick={action.onClick}>{action.label}</button>)}
    {status?<span className={'scope-inline-save-status'+(statusClassName?' '+statusClassName:'')}
      role={statusRole} aria-live={statusRole==='status'?'polite':undefined}>{status}</span>:null}
  </div>:null;
  if(mode==='actions')return actionBar;
  const renderFields=()=>fields.map(field=>{
    if(field.kind==='node')return field.bare
      ?<Fragment key={field.key}>{field.node}</Fragment>
      :<div key={field.key}>{field.node}</div>;
    if(field.kind==='rich'){
      const element=<BlockNoteEditor editorKey={field.editorKey} content={field.content}
        onBlocksChange={field.onBlocksChange} onHtmlChange={field.onHtmlChange}
        onPlainTextChange={field.onPlainTextChange} canInsertImage={field.canInsertImage!==false}
        editable={field.disabled!==true} plainTextOnly={field.plainTextOnly===true}
        suggestionKind={field.suggestionKind||''} suggestions={field.suggestions||[]}
        ariaLabel={field.ariaLabel||'文字編輯器'}/>;
      return field.bare?<Fragment key={field.key}>{element}</Fragment>
        :<div key={field.key} className="scope-management-wide-field">
          {field.label!=null?<span>{field.label}</span>:null}
          {element}
        </div>;
    }
    return <label key={field.key} className={'scope-management-wide-field'+(field.key==='eyebrow'||field.key==='title'||field.key==='subtitle-line'?' scope-frame-header-field':'')}>
      <span>{field.label}</span>
      <input className="scope-search-input" value={field.value??''} type="text"
        maxLength={field.maxLength} title={field.hint||undefined}
        onChange={event=>field.onChange?.(event.target.value)} disabled={field.disabled===true}/>
    </label>;
  });
  // Field schema, article attributes and actions are independent capabilities:
  // combine them in one editor rather than fork by page or feature.
  if(mode==='fields')return <>{renderFields()}</>;
  if(mode==='scope')return <div className="scope-editor scope-page-editor">
    {actionBar}
    <div className="scope-frame-field-grid">{renderFields()}</div>
  </div>;
  if(!draft||!['article','attr'].includes(mode))return null;
  const resolvedAttributeTitle=attributeTitle||t('uiExtra.searchUI.attributeTitle');
  return <div className="scope-editor scope-search-article-editor">
    {renderFields()}
    {mode==='article'&&showBodyEditor?<div className="scope-editor-blocknote"><span>{UI_COPY.common.body}</span>
      <BlockNoteEditor editorKey={'article:'+String(draft.editorKey||'')}
        content={draft.bodyHtml??draft.bodyBlocks}
        onBlocksChange={blocks=>onChange?.(current=>({...current,bodyBlocks:blocks,body:blocksToPlainText(blocks)}))}
        onHtmlChange={html=>onChange?.(current=>({...current,bodyHtml:html}))}/>
    </div>:null}
    {mode==='article'&&showHidden?<div className="scope-editor-options">
      <label><input type="checkbox" checked={draft.hidden===true}
        onChange={event=>onChange?.(current=>({...current,hidden:event.target.checked,attrs:current.attrs?{...current.attrs,list:!event.target.checked,search:!event.target.checked}:current.attrs}))}/>{UI_COPY.common.hiddenFromSearch}</label>
    </div>:null}
    {Array.isArray(attributeFields)&&attributeFields.length?<section className="scope-search-attr-panel" aria-label={resolvedAttributeTitle}>
      <h3 className="scope-search-attr-heading">{resolvedAttributeTitle}</h3>
      <div className="scope-search-attr-grid">
        {attributeFields.map(({key,kind='text',readOnly=false})=>{
          const fieldLabel=t('uiExtra.searchUI.fieldLabels.'+key);
          const current=key==='title'?draft.title:draft.attrs?.[key];
          const editValue=key==='content'?t('uiExtra.searchUI.attrShown'):current;
          const setValue=value=>onChange?.(previous=>key==='title'?{...previous,title:value}:{...previous,attrs:{...(previous.attrs||{}),[key]:value}});
          const Wrapper=kind==='multiline'&&!readOnly?'div':'label';
          return <Wrapper className={'scope-search-attr-item'+(!readOnly?' is-editable':'')} key={key}>
            <span className="scope-search-attr-name">{fieldLabel}</span>
            {readOnly?<span className="scope-search-attr-value">{String(editValue??'')}</span>
              :kind==='boolean'?<span className="scope-search-attr-boolean">
                <input type="checkbox" checked={current===true} onChange={event=>setValue(event.target.checked)}/>
                <span>{current===true?'true':'false'}</span>
              </span>
              :kind==='multiline'?<BlockNoteEditor
                editorKey={'article-attribute:'+String(draft.editorKey||'')+':'+key}
                content={String(current??'')} ariaLabel={fieldLabel}
                plainTextOnly canInsertImage={false} onPlainTextChange={setValue}/>
              :kind==='array'?<textarea rows={2} aria-label={fieldLabel}
                value={String(current??'')} onChange={event=>setValue(event.target.value)}/>
              :<input aria-label={key} type={kind==='date'?'datetime-local':kind==='number'?'number':'text'}
                value={String(current??'')} onChange={event=>setValue(event.target.value)}/>}
            {key==='media_link'&&mediaHref?String(current||'').split(/[\n,]+/).map(id=>id.trim()).filter(Boolean).map(id=><ScopeLink key={id} href={mediaHref(id)} className="scope-search-media-edit-link">{t('uiExtra.searchUI.editMedia',{id})}</ScopeLink>):null}
          </Wrapper>;
        })}
      </div>
    </section>:null}
  </div>;
}
