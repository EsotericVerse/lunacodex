'use client';

// One autonomous editing session for every Scope home, feature hero and
// search suggestion block. Mounted only after an authorized edit action.
import {useRef,useState} from 'react';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';
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
import {invalidateScopeBlockPage,selectLiveScopeBlocks} from './scope-data';

const BlockNoteEditor=dynamic(()=>import('./BlockNoteEditor'),{loading:()=>null});
const ObjectEditor=dynamic(()=>import('./BlockNoteEditor').then(mod=>mod.ObjectEditor),{loading:()=>null});

export default function ScopeBlockEditorSession({
  initial,scopeId,pageName,slot,movableSlots=[],movableIndex=-1,
  normalizedOrders=[],allowDelete=true,allowEntities=true,allowImages=true,
  editEyebrow=true,onClose,onDone
}){
  useUiSection('uiExtra.editBlocks');
  useUiSection('uiExtra.frameEditor');
  const t=useUiText();
  const queryClient=useQueryClient();
  const editDock=useEditDock();
  const inDock=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  const initialSnapshot=useRef(JSON.stringify({...initial,entities:HomeBlock.normalizeEntities(initial.entities)}));
  const [draft,setDraft]=useState(()=>({...initial,entities:HomeBlock.normalizeEntities(initial.entities)}));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  async function updateBlockCaches(rows){
    invalidateScopeBlockPage(scopeId,pageName);
    await Promise.all([
      queryClient.setQueryData(appBootstrapKey(scopeId,pageName),
        current=>current?{...current,blocks:rows}:current),
      queryClient.setQueryData(['scope-blocks',scopeId,pageName],rows)
    ]);
  }
  async function refreshBlockQueries(){
    // Reordering changes another row's order; read one committed page, not two.
    const rows=await selectLiveScopeBlocks(scopeId,pageName);
    await updateBlockCaches(rows);
  }
  const cancel=()=>onClose();
  const isHomeFrame=isHomeFrameFor(scopeId,pageName,draft.order);
  const image= isHomeFrame?resolveHomeImage(draft,scopeId):null;
  const titleLimit=64;
  const englishLimit=64;
  const subtitleLimit=128;
  const subtitleValue=HomeBlock.plainBlockLine;
  const stripInlineImage=value=>String(value||'').replace(/<img\b[^>]*>/gi,'');
  function configureImage(changes,removeEmbedded=true){
    setDraft(current=>{
      const base=current.image&&typeof current.image==='object'?current.image:{};
      const next={...current,image:{...base,...changes}};
      return removeEmbedded?{...next,
        subtitle:stripInlineImage(next.subtitle),
        text:stripInlineImage(next.text),
        entities:next.entities.map(entity=>({...entity,text:stripInlineImage(entity.text)}))
      }:next;
    });
  }

  function canInsertImageIn(html=''){
    return !draft||BlockNoteContent.image.frameImageCount(draft)-BlockNoteContent.image.countHtmlImages(html)===0;
  }

  function updateEntity(index,patch){
    setDraft(current=>{
      if(!current)return current;
      const entities=current.entities.map((entity,entityIndex)=>entityIndex===index?{...entity,...patch}:entity);
      return {...current,entities};
    });
  }

  function addEntity(){
    setDraft(current=>{
      if(!current||current.entities.length>=HomeBlock.entityLimit)return current;
      return {
        ...current,
        entities:[...current.entities,{uid:HomeBlock.createUid(),title:'',text:'',order:current.entities.length+1}]
      };
    });
  }

  function removeEntity(index){
    setDraft(current=>{
      if(!current)return current;
      const mode=BlockNoteContent.image.heroImageMode(current);
      const entities=current.entities
        .filter((_,entityIndex)=>entityIndex!==index)
        .map((entity,entityIndex)=>({...entity,order:entityIndex+1}));
      if(current.order===1&&entities.length){
        entities.forEach(entity=>delete entity.image_mode);
        if(mode==='side')entities[0].image_mode='side';
      }
      return {...current,entities};
    });
  }

  function moveEntity(index,direction){
    setDraft(current=>{
      if(!current)return current;
      const target=index+direction;
      if(target<0||target>=current.entities.length)return current;
      const mode=BlockNoteContent.image.heroImageMode(current);
      const entities=[...current.entities];
      [entities[index],entities[target]]=[entities[target],entities[index]];
      const ordered=entities.map((entity,entityIndex)=>({...entity,order:entityIndex+1}));
      if(current.order===1&&ordered.length){
        ordered.forEach(entity=>delete entity.image_mode);
        if(mode==='side')ordered[0].image_mode='side';
      }
      return {...current,entities:ordered};
    });
  }

  async function moveBlock(direction){
    if(!draft?.stored||busy||normalizedOrders.length||
      !HomeBlock.canSwapHomeBlockPositions(pageName,movableSlots,movableIndex,movableIndex+direction))return;
    setBusy(true);setMessage(t('uiExtra.editBlocks.moving'));
    try{
      const {moveScopeBlock}=await import('./db-client.mjs');
      const result=await moveScopeBlock(scopeId,pageName,draft.uid,direction);
      setDraft(current=>current?.uid===draft.uid?{...current,order:Number(result.block_order)||current.order}:current);
      await refreshBlockQueries();
      setMessage(t('uiExtra.editBlocks.moved'));
    }catch(error){
      setMessage(t('uiExtra.editBlocks.moveFailed',{error:String(error?.message||error)}));
    }finally{setBusy(false);}
  }

  async function save(){
    if(!draft||busy)return false;
    setBusy(true);setMessage(t('uiExtra.editBlocks.saving'));
    try{
      if(!BlockNoteContent.text.hasBlockNoteFrameContent(draft))throw new Error(t('uiExtra.editBlocks.emptyContent'));
      if(Array.from(String(draft.title||'')).length>titleLimit)throw new Error(t('uiExtra.frameEditor.titleTooLong',{limit:titleLimit}));
      if(Array.from(String(draft.eyebrow||'')).length>englishLimit)throw new Error(t('uiExtra.frameEditor.eyebrowTooLong',{limit:englishLimit}));
      if(Array.from(String(draft.subtitle||'')).length>subtitleLimit)throw new Error(t('uiExtra.frameEditor.subtitleTooLong',{limit:subtitleLimit}));
      if(isHomeFrame&&draft.image?.source==='custom'&&String(draft.image.url||'').trim()&&!BlockNoteContent.image.normalizeImageSource(draft.image.url))throw new Error(t('uiExtra.frameEditor.imageUrlInvalid'));
      const embeddedImages=BlockNoteContent.image.frameImageCount(draft);
      if(!allowImages&&embeddedImages>0)throw new Error(t('uiExtra.editBlocks.textOnly'));
      if(embeddedImages>1)throw new Error(t('uiExtra.editBlocks.oneImage'));
      if(embeddedImages===1&&!BlockNoteContent.image.firstFrameImageUrl(draft))throw new Error(t('uiExtra.editBlocks.invalidImage'));
      const normalizeSavedHtml=value=>scopeId==='loc'&&pageName==='index'
        ?HomeBlock.stripLocHomeEditorPlaceholders(value)
        :String(value??'');
      const values={
        page_name:pageName,
        block_eyebrow:subtitleValue(draft.eyebrow),
        block_title:subtitleValue(draft.title),
        block_subtitle:subtitleValue(draft.subtitle),
        ...(isHomeFrame?{block_image:draft.image?.source==='custom'&&!String(draft.image.url||'').trim()?{...draft.image,source:'default',url:''}:(draft.image||null)}:{}),
        block_text:normalizeSavedHtml(draft.text),
        block_order:Number(draft.order)||1,
        block_entity:HomeBlock.serializeBubbleEntities(draft.bubbleColumns,HomeBlock.normalizeEntities(draft.entities).map(({uid,title,text,image_mode},index)=>({
          uid,
          title:String(title||'').trim(),
          text:normalizeSavedHtml(text),
          ...(pageName==='index'&&draft.order===1&&index===0&&image_mode==='side'?{image_mode:'side'}:{})
        })),pageName)
      };
      // Single-item editor uses the very same page-level save boundary.
      // Existing sibling Blocks stay in the snapshot instead of being removed.
      const {dbAuthClient}=await import('./db-client.mjs');
      const before=await selectLiveScopeBlocks(scopeId,pageName);
      const existingRows=before.filter(row=>row.uid!==draft.uid);
      const normalized={
        uid:draft.uid,...values,
        block_image:values.block_image===undefined
          ?before.find(row=>row.uid===draft.uid)?.block_image??null
          :values.block_image==null?null:typeof values.block_image==='string'
            ?values.block_image:JSON.stringify(values.block_image)
      };
      const snapshot=[...existingRows,normalized];
      const {error}=await dbAuthClient.schema('silver').managedAction('save_blocks',{
        p_scope_id:scopeId,p_type:pageName,p_rows:snapshot
      });
      if(error)throw new Error(error.message||'Blocks 儲存失敗');
      // A successful SQL write is final. Update the two client views from the
      // committed values instead of issuing parallel post-save SELECTs.
      let displayWarning='';
      try{
        const key=appBootstrapKey(scopeId,pageName);
        const existing=queryClient.getQueryData(key)||{};
        if(!Array.isArray(existing.blocks)){
          // A concurrent metadata invalidation may have cleared this page.
          // Only then read once; never replace sibling blocks with one row.
          await refreshBlockQueries();
        }else{
          const previous=existing.blocks.find(row=>row.uid===draft.uid)||{};
          const committed={...previous,uid:draft.uid,...values};
          const rows=existing.blocks.filter(row=>row.uid!==draft.uid);
          rows.push(committed);
          rows.sort((a,b)=>(Number(a.block_order)||0)-(Number(b.block_order)||0));
          await updateBlockCaches(rows);
        }
      }catch{displayWarning='（顯示快取尚未更新，重新載入頁面即可）';}
      initialSnapshot.current=JSON.stringify(draft);
      onDone(t('uiExtra.editBlocks.saved')+displayWarning);
      return true;
    }catch(error){
      setMessage(t('uiExtra.editBlocks.saveFailedPrefix')+String(error?.message||error||t('uiExtra.editBlocks.unknown')));
      return false;
    }finally{
      setBusy(false);
    }
  }

  async function remove(){
    if(!draft)return;
    if(!draft.stored){
      onClose();
      return;
    }
    setBusy(true);setMessage('');
    try{
      const {dbAuthClient}=await import('./db-client.mjs');
      const current=await selectLiveScopeBlocks(scopeId,pageName);
      const {error}=await dbAuthClient.schema('silver').managedAction('save_blocks',{
        p_scope_id:scopeId,p_type:pageName,p_rows:current.filter(row=>row.uid!==draft.uid)
      });
      if(error)throw new Error(error.message||'Blocks 刪除失敗');
      await refreshBlockQueries();
      onDone(t('uiExtra.editBlocks.deleted'));
    }catch(error){
      setMessage(error?.message||t('uiExtra.editBlocks.deleteFailed'));
    }finally{
      setBusy(false);
    }
  }

  function renderEditableEntities(entities){
    return <div className="scope-block-entity-grid" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([draft.bubbleColumns],pageName)}}>
      {entities.map((entity,index)=><article className={HomeBlock.childPresentation(entity.title)==='card'?'scope-block-entity':'loc-bubble scope-block-text-bubble'} key={entity.uid}>

          <div className="scope-block-entity-actions">
            <button type="button" className="loc-button" disabled={index===0||busy} onClick={()=>moveEntity(index,-1)}>←</button>
            <button type="button" className="loc-button" disabled={index===entities.length-1||busy} onClick={()=>moveEntity(index,1)}>→</button>
            <button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>removeEntity(index)}><UiText id="uiExtra.editBlocks.remove"/></button>
          </div>
          <label className="scope-management-wide-field">
            <span><UiText id="uiExtra.editBlocks.childTitleHint"/></span>
            <input
              className="scope-search-input"
              placeholder={t('uiExtra.editBlocks.bubbleHint')}
              value={entity.title}
              onChange={event=>updateEntity(index,{title:event.target.value})}
            />
          </label>
          <BlockNoteEditor
            editorKey={entity.uid+':edit'}
            content={entity.text?{html:entity.text}:''}
            onHtmlChange={html=>updateEntity(index,{text:html})}
            canInsertImage={allowImages&&canInsertImageIn(entity.text)}
          />

      </article>)}
      {entities.length<HomeBlock.entityLimit?<button type="button" className="scope-block-entity-add" onClick={addEntity} disabled={busy}>
        <UiText id="uiExtra.editBlocks.addChild"/>
      </button>:null}
    </div>;
  }
  useEditDockForm({save,isDirty:()=>JSON.stringify(draft)!==initialSnapshot.current,isBusy:()=>busy});
  return <>
          <ObjectEditor mode="actions" actionClassName="scope-inline-editbar" actions={[
            ...(inDock?[]:[{key:'save',primary:true,disabled:busy,onClick:save,label:busy?t('uiExtra.editBlocks.saving'):t('uiExtra.editBlocks.save')}]),
            ...(slot.stored&&movableSlots.length>1&&!HomeBlock.isPinnedHomeHero(pageName,slot)?[
              {key:'up',disabled:busy||!HomeBlock.canSwapHomeBlockPositions(pageName,movableSlots,movableIndex,movableIndex-1),onClick:()=>moveBlock(-1),label:<UiText id="uiExtra.editBlocks.moveUp"/>},
              {key:'down',disabled:busy||!HomeBlock.canSwapHomeBlockPositions(pageName,movableSlots,movableIndex,movableIndex+1),onClick:()=>moveBlock(1),label:<UiText id="uiExtra.editBlocks.moveDown"/>}
            ]:[]),
            ...(allowDelete?[{key:'delete',danger:true,disabled:busy,onClick:remove,label:<UiText id="uiExtra.editBlocks.remove"/>}]:[]),
            ...(inDock?[]:[{key:'cancel',disabled:busy,onClick:cancel,label:<UiText id="uiExtra.editBlocks.cancel"/>}])
          ]} status={message}
            statusClassName={message.startsWith(t('uiExtra.editBlocks.saveFailedPrefix'))?'scope-error':''}/>
          <div className="scope-editor-stage"><h3 className="scope-editor-stage__title">文字內容</h3>
          <ObjectEditor mode="scope" fields={[
            ...(editEyebrow?[{
              key:'eyebrow',label:<UiText id="uiExtra.editBlocks.englishEyebrow"/>,
              value:draft.eyebrow,maxLength:englishLimit,onChange:value=>setDraft(current=>({...current,eyebrow:value}))
            }]:[]),
            {
              key:'title',label:<UiText id="uiExtra.editBlocks.chineseHeadline"/>,
              value:draft.title,maxLength:titleLimit,onChange:value=>setDraft(current=>({...current,title:value}))
            },
            {
              key:'subtitle-line',label:<UiText id="uiExtra.editBlocks.subtitle"/>,
              value:subtitleValue(draft.subtitle),maxLength:subtitleLimit,
              onChange:value=>setDraft(current=>({...current,subtitle:value}))
            },
            {
              key:'body',kind:'rich',label:<UiText id="uiExtra.editBlocks.body"/>,
              editorKey:draft.uid+':body:edit',content:draft.text?{html:draft.text}:'',
              onHtmlChange:html=>setDraft(current=>({...current,text:html})),
              canInsertImage:allowImages&&!isHomeFrame&&canInsertImageIn(draft.text)
            }
          ]}/>
          </div>
          {isHomeFrame?<div className="scope-editor-stage"><h3 className="scope-editor-stage__title">主視覺圖片</h3><HeroImageFieldset draft={draft} image={image} allowImageOnly={pageName==='index'} onChange={configureImage}/></div>:null}
          {allowEntities?<div className="scope-editor-stage">
            <h3 className="scope-editor-stage__title">附屬內容</h3>
            <label className="scope-bubble-layout-control">文字泡泡排列（每列）
              <select className="scope-select" value={draft.bubbleColumns} onChange={e=>setDraft(current=>({...current,bubbleColumns:Number(e.target.value)}))}>
                {[2,3,6].map(n=><option key={n} value={n}>{n} 個</option>)}
              </select>
            </label>
            {renderEditableEntities(draft.entities)}
          </div>:null}
  </>;
}
