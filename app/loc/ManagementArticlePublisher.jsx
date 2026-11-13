'use client';
import UiText,{useUiText} from '../i18n/UiText';

import {UI_COPY,registerDefaultSection} from '../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../i18n/ui-locale';
import managementZh from '../i18n/sections/management.zh_tw.js';
import publisherZh from '../i18n/sections/uiExtra.publisher.zh_tw.js';
import sharingZh from '../i18n/sections/uiExtra.sharing.zh_tw.js';
registerDefaultSection('management',managementZh);
registerDefaultSection('uiExtra.publisher',publisherZh);
// uiExtra.sharing currently has no consumer in the codebase; it is kept
// registered here (its content unchanged) so it stays reachable rather than
// silently dropped by this split.
registerDefaultSection('uiExtra.sharing',sharingZh);
import {useEffect,useRef,useState} from 'react';
import {useEditDock} from '../modular/edit-dock';
import {insertRows,updateRows} from './db-client.mjs';
import {selectRows} from './db-query.mjs';
import {useAccount} from './use-account';
import {createUid8} from './uid';
import {normalizeRelationIds,requireGalaxyContent,resolveGalaxyTitle} from './content-policy';
import {ObjectEditor} from './BlockNoteEditor';
import {blocksToPlainText,plainTextToBlocks} from './blocknote-content.mjs';
import {GALAXY_ABLE_KEYS,galaxyAble,privateGalaxySource} from './galaxy-able.mjs';
import {galaxyReadColumnsFor} from '../../zenstack/galaxy-read-models.mjs';

const GALAXY_PERMISSION_LABELS=Object.freeze({
  statics:'統計',culture:'文化',search:'搜尋',trace:'痕跡',list:'文章列表',
  keyword:'關鍵詞',extract:'搜尋片段',others:'其他'
});

const datetimeLocal=value=>{
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
};

const recordDraft=row=>({
  title:String(row.title||''),bodyBlocks:plainTextToBlocks(''),bodyHtml:String(row.content||''),
  editorKey:createUid8(),source:String(row.site||''),site_id:String(row.site_id||''),url:String(row.url||''),
  source_id:String(row.source_id||''),
  target_id:Array.isArray(row.target_id)?row.target_id.join(', '):String(row.target_id||''),
  ref_id:String(row.ref_id||''),createtime:datetimeLocal(row.createtime),permissions:galaxyAble(row)
});

const blank=()=>({
  title:'',bodyBlocks:plainTextToBlocks(''),bodyHtml:'',editorKey:createUid8(),source:'',site_id:'',url:'',source_id:'',target_id:'',ref_id:'',createtime:'',
  permissions:galaxyAble({})
});

export default function ManagementArticlePublisher({scopeId}){
  useUiSection('management');
  useUiSection('uiExtra.publisher');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const account=useAccount();
  const editDock=useEditDock();
  const dockActions=useRef({save:null,discard:null});
  const activateDock=useRef(()=>{});
  const inDock=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  const [draft,setDraft]=useState(blank());
  const [lookupUid,setLookupUid]=useState('');
  const [editingUid,setEditingUid]=useState('');
  const [loadingUid,setLoadingUid]=useState(false);
  const loadedBaseline=useRef(null);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
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

  if(!scopeId||!account.canLocAccessSync('scope',scopeId))return null;
  const change=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const isDirty=()=>{
    if(editingUid&&loadedBaseline.current){
      const original=loadedBaseline.current;
      return ['title','bodyHtml','source','url','source_id','target_id','ref_id','createtime']
        .some(key=>draft[key]!==original[key])||GALAXY_ABLE_KEYS.some(key=>
          draft.permissions?.[key]!==original.permissions?.[key]);
    }
    return Boolean(draft.title.trim()||draft.source.trim()||draft.url.trim()||
      draft.source_id.trim()||draft.target_id.trim()||draft.ref_id.trim()||
      draft.createtime||blocksToPlainText(draft.bodyHtml||draft.bodyBlocks).trim());
  };
  const resetDraft=()=>{
    setDraft(blank());setEditingUid('');setLookupUid('');
    loadedBaseline.current=null;setStatus('');
  };
  async function loadByUid(){
    if(busy||loadingUid)return;
    const uid=lookupUid.trim();
    if(!/^[A-Za-z0-9]{8}$/.test(uid)){
      setStatus(t('uiExtra.publisher.invalidUid'));return;
    }
    if(isDirty()&&!window.confirm(t('uiExtra.publisher.replaceDraftConfirm')))return;
    setLoadingUid(true);setStatus('');
    try{
      const galaxy=account.scopeDataFor(scopeId)?.galaxy;
      if(!galaxy)throw new Error(t('uiExtra.publisher.scopeUnavailable'));
      // Exact, authenticated UID lookup: no public-search index or searchable filter.
      const {rows}=await selectRows(galaxy,{
        columns:scopeId==='local'
          ?'uid,title,content,site,site_id,createtime,able,url,source_id,target_id,ref_id'
          :galaxyReadColumnsFor('GalaxyUidRead','GalaxyAttr').concat('site_id')
            .filter((column,index,all)=>all.indexOf(column)===index).join(','),
        filters:[{column:'uid',operator:'eq',value:uid}],limit:1,authenticated:true
      });
      if(!rows?.length)throw new Error(t('uiExtra.publisher.uidNotFound'));
      const loaded=recordDraft(rows[0]);
      loadedBaseline.current=loaded;
      setDraft(loaded);setEditingUid(rows[0].uid);setLookupUid(rows[0].uid);
      setStatus(t('uiExtra.publisher.articleLoaded'));
    }catch(error){setStatus(String(error?.message||error));}
    finally{setLoadingUid(false);}
  }

  async function save(event){
    event?.preventDefault?.();
    if(busy||loadingUid)return false;
    setBusy(true);setStatus('');
    try{
      const content=await requireGalaxyContent(draft.bodyHtml||blocksToPlainText(draft.bodyBlocks));
      if(!editingUid&&!draft.source.trim())throw new Error(UI_COPY.management.sourceRequired);
      const now=new Date().toISOString();
      const galaxy=account.scopeDataFor(scopeId)?.galaxy;
      if(!galaxy)throw new Error(t('uiExtra.publisher.scopeUnavailable'));

      const values={
        title:resolveGalaxyTitle(draft.title,content),
        content,
        source_id:draft.source_id.trim()||null,
        target_id:normalizeRelationIds(draft.target_id),
        ref_id:draft.ref_id.trim()||null,
        url:draft.url.trim()||null,
        ...galaxyAble({...draft.permissions,site:draft.source,site_id:draft.site_id,title:draft.title}),
        createtime:draft.createtime?new Date(draft.createtime).toISOString():now,
        site:draft.source.trim()
      };
      if(editingUid){
        // Update only edited fields: don't rewrite unrelated metadata, null
        // searchable flags, or timestamps on older Galaxy articles.
        const original=loadedBaseline.current;
        if(!original)throw new Error(t('uiExtra.publisher.uidNotFound'));
        const changed={};
        if(draft.title!==original.title)changed.title=values.title;
        if(draft.bodyHtml!==original.bodyHtml)changed.content=values.content;
        if(draft.source!==original.source)changed.site=values.site;
        if(draft.url!==original.url)changed.url=values.url;
        if(draft.source_id!==original.source_id)changed.source_id=values.source_id;
        if(draft.target_id!==original.target_id)changed.target_id=values.target_id;
        if(draft.ref_id!==original.ref_id)changed.ref_id=values.ref_id;
        if(draft.createtime!==original.createtime)changed.createtime=values.createtime;
        for(const key of GALAXY_ABLE_KEYS){
          if(values[key]!==original.permissions?.[key])changed[key]=values[key];
        }
        if(Object.keys(changed).length){
          await updateRows(galaxy,{...changed,UpdateTime:now},{
            filters:[{column:'uid',operator:'eq',value:editingUid}]
          });
        }
        loadedBaseline.current={...draft};
        setStatus(Object.keys(changed).length
          ?t('uiExtra.publisher.articleUpdated')
          :t('uiExtra.publisher.noChanges'));
      }else{
        await insertRows(galaxy,[{uid:createUid8(),...values}]);
        resetDraft();
        setStatus(UI_COPY.management.articlePublished);
      }
      return true;
    }catch(error){
      const message=error?.message||UI_COPY.management.articlePublishFailed;
      setStatus(message);
      if(inDock)editDock.setNotice(message);
      return false;
    }finally{
      setBusy(false);
    }
  }
  dockActions.current={
    save:()=>save(),
    discard:resetDraft,
    isDirty,
    isBusy:()=>busy||loadingUid
  };

  return <section className="loc-card scope-feature-card"
    onFocusCapture={()=>activateDock.current?.()}
    onPointerDownCapture={()=>activateDock.current?.()}>
    <p className="loc-eyebrow">Publish</p>
    <h2>{UI_COPY.management.article}</h2>
    <form className="scope-publisher" onSubmit={save}>
      <div className="scope-publisher-main">
        <ObjectEditor mode="fields" fields={[
          {key:'title',kind:'node',bare:false,node:<input
            className="scope-publisher-title"
            value={draft.title}
            onChange={event=>change('title',event.target.value)}
            placeholder={t('uiExtra.publisher.addTitle')}
            aria-label={t('uiExtra.publisher.articleTitle')}/>,label:<UiText id="uiExtra.publisher.articleTitle"/>},
          {key:'body',kind:'rich',label:<UiText id="uiExtra.publisher.articleBody"/>,
            editorKey:'publisher:'+scopeId+':'+draft.editorKey,
            content:draft.bodyHtml||draft.bodyBlocks,
            onBlocksChange:blocks=>change('bodyBlocks',blocks),
            onHtmlChange:html=>change('bodyHtml',html)}
        ]}/>
      </div>

      <aside className="scope-publisher-sidebar">
        <section className="scope-publisher-panel">
          <h3><UiText id="uiExtra.publisher.publish"/></h3>
          <label>
            <span><UiText id="uiExtra.publisher.articleUid"/></span>
            <input value={lookupUid} maxLength={8} spellCheck={false}
              onChange={event=>setLookupUid(event.target.value.trim())}
              onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void loadByUid();}}}
              placeholder={t('uiExtra.publisher.uidPlaceholder')}
              aria-label={t('uiExtra.publisher.articleUid')}/>
          </label>
          <div className="scope-preview-links">
            <button type="button" className="loc-button" disabled={busy||loadingUid}
              onClick={loadByUid}>{loadingUid?t('uiExtra.publisher.loadingUid'):t('uiExtra.publisher.findUid')}</button>
            {editingUid?<button type="button" className="loc-button" disabled={busy||loadingUid}
              onClick={()=>{if(isDirty()&&!window.confirm(t('uiExtra.publisher.replaceDraftConfirm')))return;resetDraft();}}><UiText id="uiExtra.publisher.newArticle"/></button>:null}
          </div>
          {editingUid?<p className="scope-status">{t('uiExtra.publisher.editingUid')}: {editingUid}</p>:null}
          <label>
            <span>{UI_COPY.management.articleTime}</span>
            <input type="datetime-local" value={draft.createtime} onChange={event=>change('createtime',event.target.value)}/>
          </label>
          <fieldset className="scope-publisher-panel" style={{border:0,padding:0}}>
            <legend>文章八項權限</legend>
            {privateGalaxySource({site:draft.source,site_id:draft.site_id,title:draft.title})
              ?<p className="scope-status">MCP 與 PR 開發紀錄保持私人，不可啟用公開旗標。</p>:null}
            {GALAXY_ABLE_KEYS.map(key=><label className="scope-setting-toggle" key={key}>
              <input type="checkbox" checked={draft.permissions?.[key]===true}
                disabled={privateGalaxySource({site:draft.source,site_id:draft.site_id,title:draft.title})}
                onChange={event=>change('permissions',{...draft.permissions,[key]:event.target.checked})}/>
              {GALAXY_PERMISSION_LABELS[key]} ({key})
            </label>)}
          </fieldset>
          {!inDock?<button className="loc-button primary" type="submit" disabled={busy||loadingUid}><UiText id={busy?'uiExtra.publisher.publishing':editingUid?'uiExtra.publisher.saveChanges':'uiExtra.publisher.publishArticle'}/></button>:null}
        </section>

        <section className="scope-publisher-panel">
          <h3><UiText id="uiExtra.publisher.source"/></h3>
          <label>
            <span>{UI_COPY.management.articleSource}</span>
            <input value={draft.source} onChange={event=>change('source',event.target.value)} placeholder={t('uiExtra.publisher.sourceHint')} required={!editingUid}/>
          </label>
          <label>
            <span>{UI_COPY.management.articleUrl}</span>
            <input value={draft.url} onChange={event=>change('url',event.target.value)} placeholder="https://…"/>
          </label>
        </section>

        <details className="scope-publisher-panel">
          <summary><UiText id="uiExtra.publisher.relations"/></summary>
          <label><span><UiText id="uiExtra.publisher.parentArticleId"/></span><input value={draft.source_id} onChange={event=>change('source_id',event.target.value)} placeholder={UI_COPY.management.articleParent}/></label>
          <label><span><UiText id="uiExtra.publisher.targetArticleId"/></span><input value={draft.target_id} onChange={event=>change('target_id',event.target.value)} placeholder={UI_COPY.management.articleTarget}/></label>
          <label><span><UiText id="uiExtra.publisher.referenceArticleId"/></span><input value={draft.ref_id} onChange={event=>change('ref_id',event.target.value)} placeholder={UI_COPY.management.articleReference}/></label>
        </details>
      </aside>
    </form>

    {status?<p className={'scope-status'+([UI_COPY.management.articlePublished,t('uiExtra.publisher.articleUpdated'),t('uiExtra.publisher.noChanges'),t('uiExtra.publisher.articleLoaded')].includes(status)?'':' scope-error')} role="status">{status}</p>:null}
  </section>;
}
