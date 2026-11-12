'use client';
import FieldText from '../i18n/FieldText';

import {useEffect,useRef} from 'react';
import {SuggestionMenuController,useCreateBlockNote} from '@blocknote/react';
import {blockNoteSuggestionItems} from './blocknote-suggestions.mjs';
import {BlockNoteView} from '@blocknote/mantine';
import {canonicalBlockNoteBlocks,canonicalBlockNoteHtml,BlockNoteContent} from './blocknote-content.mjs';

// Keep the native BlockNote/Mantine tools, menus and portalled suggestions
// on the same live LOC palette as the editor surface. Using CSS var() lets
// every published theme switch without remounting the editor or changing data.
const LOC_BLOCKNOTE_THEME={
  colors:{
    editor:{text:'var(--loc-text)',background:'var(--loc-panel)'},
    menu:{text:'var(--loc-text)',background:'var(--loc-panel-strong)'},
    tooltip:{text:'var(--loc-text)',background:'var(--loc-panel-2)'},
    hovered:{text:'var(--loc-text)',background:'var(--loc-accent-surface)'},
    selected:{text:'var(--loc-text)',background:'var(--loc-accent-surface-strong)'},
    disabled:{text:'var(--loc-muted)',background:'var(--loc-surface-soft)'},
    shadow:'var(--loc-line)',
    border:'var(--loc-line)',
    sideMenu:'var(--loc-muted)'
  },
  borderRadius:12,
  fontFamily:'var(--loc-font-family)'
};

export default function BlockNoteEditorClient({
  initialBlocks=[],
  initialHtml='',
  initialMarkdown='',
  editable=true,
  canInsertImage=true,
  suggestionKind='',
  suggestions=[],
  plainTextOnly=false,
  ariaLabel='文字編輯器',
  onChange=null,
  onHtmlChange=null
}){
  const editor=useCreateBlockNote({
    initialContent:canonicalBlockNoteBlocks(initialBlocks),
    domAttributes:{editor:{'aria-label':editable?ariaLabel:'文字內容'}}
  });
  const hydratedLegacyHtml=useRef(false);
  const htmlEmitVersion=useRef(0);
  const lastEmittedBlocks=useRef('');

  useEffect(()=>{
    if(hydratedLegacyHtml.current)return;
    hydratedLegacyHtml.current=true;
    if(!initialHtml&&!initialMarkdown)return;
    let mounted=true;
    // HTML imports can be asynchronous; never pass a Promise to replaceBlocks.
    const apply=blocks=>{
      if(mounted)editor.replaceBlocks(editor.document,canonicalBlockNoteBlocks(blocks));
    };
    try{
      const parsed=initialHtml
        ?editor.tryParseHTMLToBlocks(canonicalBlockNoteHtml(initialHtml))
        :editor.tryParseMarkdownToBlocks(initialMarkdown);
      if(typeof parsed?.then==='function')parsed.then(apply).catch(error=>console.error('BlockNote HTML import failed',error));
      else apply(parsed);
    }catch(error){
      console.error('BlockNote HTML import failed',error);
    }
    return ()=>{mounted=false;};
  },[editor,initialHtml,initialMarkdown]);

  const emit=()=>{
    // BlockNote JSON is the editing source of truth. Empty paragraphs must
    // remain empty blocks, never literal ProseMirror U+FFFC characters.
    const blocks=canonicalBlockNoteBlocks(editor.document);
    const fingerprint=JSON.stringify(blocks);
    if(fingerprint===lastEmittedBlocks.current)return;
    lastEmittedBlocks.current=fingerprint;
    onChange?.(blocks);
    if(!onHtmlChange)return;
    const version=++htmlEmitVersion.current;
    const exported=editor.blocksToHTMLLossy(blocks);
    // Handle sync (current BlockNote) and async HTML exporters safely.
    const deliver=html=>{
      if(version===htmlEmitVersion.current)onHtmlChange(canonicalBlockNoteHtml(html));
    };
    if(typeof exported==='string')deliver(exported);
    else Promise.resolve(exported).then(deliver).catch(error=>{
      console.error('BlockNote HTML export failed',error);
    });
  };

  function insertImageUrl(event){
    event?.preventDefault?.();
    let insertionTarget=null;
    try{
      insertionTarget=editor.getTextCursorPosition?.()?.block||null;
    }catch{}
    const entered=globalThis.prompt?.('圖片網址（直接圖片連結，不上傳檔案）','https://');
    if(entered===null||entered===undefined)return;
    const image=BlockNoteContent.image.imageBlockForUrl(entered);
    if(!image){
      globalThis.alert?.('請輸入有效的 http:// 或 https:// 圖片網址。');
      return;
    }
    try{
      const findImage=blocks=>{
        for(const block of blocks||[]){
          if(block.type==='image')return block;
          const child=findImage(block.children);
          if(child)return child;
        }
        return null;
      };
      const existing=findImage(editor.document);
      if(existing){
        editor.updateBlock(existing,image);
      }else if(!canInsertImage){
        globalThis.alert?.('這個文字框架已有一張圖片。請先移除原圖，再插入其他位置。');
        return;
      }else if(!insertionTarget){
        globalThis.alert?.('請先點選要放置圖片的文字位置，再插入圖片。');
        return;
      }else{
        const current=insertionTarget;
        if(BlockNoteContent.image.isEmptyImageTarget(current)){
          editor.updateBlock(current,image);
        }else if(current){
          editor.insertBlocks([image],current,'after');
        }else{
          editor.replaceBlocks(editor.document,[image]);
        }
      }
      emit();
    }catch(error){
      console.error('BlockNote image URL insert failed',error);
      globalThis.alert?.('圖片連結插入失敗，請重新嘗試。');
    }
  }

  return <>
    {editable&&!plainTextOnly&&canInsertImage?<div className="scope-blocknote-linkbar">
      {canInsertImage?<button type="button" className="loc-button" onMouseDown={event=>event.preventDefault()} onClick={insertImageUrl}><FieldText text="圖片網址"/></button>:null}
    </div>:null}
    <BlockNoteView
      editor={editor}
      theme={LOC_BLOCKNOTE_THEME}
      editable={editable}
      onChange={editable?emit:undefined}
      formattingToolbar={plainTextOnly?false:undefined}
      slashMenu={plainTextOnly?false:undefined}
    >
      {editable&&suggestionKind?<SuggestionMenuController
        triggerCharacter="@" minQueryLength={1}
        getItems={async query=>blockNoteSuggestionItems(suggestionKind,suggestions,query).map(item=>({
          title:item.title,subtext:item.type+(item.uid?' · '+item.uid:''),
          onItemClick:()=>editor.insertInlineContent([item.title,' '])
        }))}/>:null}
    </BlockNoteView>
  </>;
}
