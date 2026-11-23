'use client';

import {useUiCopy,useUiLocale,useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';
import {UI_LOCALE_OPTIONS} from '../../i18n/ui-copy';

import {useDeferredValue,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {refreshScopeSearchSummary} from '../search/scope-summary.mjs';
import {insertRows,insertImportRows,dbAuthRelation,dbAuthClient,updateImportRows} from '../db/db-client.mjs';
import {useAccount} from '../auth/use-account';
import FlowProgress from '../../modular/FlowProgress';
import {useAsyncResource,useResourceCache} from '../../../packages/zenstack/client-queries';
import {canonicalImportSourceName,inferImportSourceFromFilename} from '../source/name.mjs';
import {Capacitor} from '@capacitor/core';
import {defaultScopeData} from '../scope/scope-data';
import {createUid8} from '../model/uid';
import {mediaAnchorRecord,mediaAnchorProjection,canonicalMediaAnchorType,MEDIA_ANCHOR_COLUMNS,ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {createImportProgressStore} from './progress-store.mjs';
import {readImportCheckpoint,writeImportCheckpoint,clearImportCheckpoint} from './checkpoint.mjs';
import {remapArchiveArticleUids} from './random-uids.mjs';
import {createImportUidResolver,remapImportUidRelations,planExistingImportUidUpdate,planImportPointUidLink,planImportMediaUrlLinks} from './uid-delta.mjs';
import {facebookBackupPlace,facebookBackupPostText,facebookBackupTimestamp} from '../archive/facebook-place.mjs';
import {archiveGalaxyRows} from '../archive/caption-rows.mjs';
import {facebookPostPlace} from '../archive/geo-objects.mjs';

import {dedupeIncomingImport,matchExistingImportBySiteId,matchExistingImportByCreatedAt,isUnchangedImportBeforeWrite,insertImportBatches} from './duplicate-check.mjs';
import {importTimeRangeWindow,filterImportAnalysisByTime} from './time-range.mjs';
import {finalizeImportCreatedTimes,importCalendarDay} from './unique-createtime.mjs';
import {prepareImportPlaceAnchors,importedPlaceId} from './place-anchors.mjs';
import {prepareImportTimeAnchors} from './time-anchors.mjs';
import {readImportPointDateAnchors} from './anchor-read.mjs';
import {readPublicSourceTaxonomy} from '../source/catalog-public.mjs';
import {auditImportedSourceSites} from '../source/classification.mjs';
import {reconcileExistingImportAnchors} from './reconcile-anchors.mjs';
import {extractImportCoordinates,importGeoKey,importMapUrlCoordinates} from './geocoordinates.mjs';
import {isPublicArchiveRecord,filterStandalonePublicRows,assertStandaloneImportDestination} from '../archive/import-safety.mjs';
import {createArchiveEvidenceCollector,prepareArchiveMedia,isArchiveMediaUrl,auditArchiveUrlAttributes} from '../archive/media-evidence.mjs';
import {publicVisualUrl,visualGalaxyCandidates} from './visual-galaxy.mjs';
import {ARCHIVE_MAX_BYTES,IMPORT_FIELD_ALIASES,UNIVERSAL_IMPORT_ACCEPT,mappedImportValue,normalizeImportMedia,parseImportCreatedTime,extractImportCreatedAt,extractImportUpdatedAt,writeImportBatches,createImportBatchSizer} from './batch.mjs';
import {MAX_ROWS,urlSafeInBatches} from '../query/query-batch-size.mjs';
import {hasIrrecoverableEncoding,isPureUrlContent,normalizeGalaxyContent,normalizeRelationIds,repairMojibakeText,resolveGalaxyTitle} from '../content/content-policy';
import {galaxyAble} from '../model/galaxy-able.mjs';
import BulkGalaxyVisibility from '../management/BulkGalaxyVisibility';
import {touchEditorSession} from '../auth/edit-session-ttl.mjs';
import {publishedSourceTaxonomy} from '../../modular/published-source-taxonomy.js';
import {runeDrawText} from '../runes/rune-draw-text.mjs';
import {galaxyReadColumns,galaxyReadColumnsFor} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {sourceImportModel,IMPORT_SOURCE_MODEL_LABELS} from '../../../packages/zenstack/import-source-models.mjs';
// Import Source options come from published, typed SiteAnchor From nodes.
// No retired ArticleTag field or SQL lookup, and no per-render reconstruction.
const PUBLISHED_SOURCE_CATEGORIES=Object.freeze({
  system:Object.freeze([...new Set(publishedSourceTaxonomy().categories
    .filter(row=>row.type==='from').map(row=>row.display_name)),'Others']),
  personal:Object.freeze([])
});
const EMPTY_IMPORT_ANALYSIS=Object.freeze({valid:[],normalized:[],mediaOnly:[],invalid:[],warnings:[]});
const GALAXY_IMPORT_TIME_COLUMNS=galaxyReadColumns('GalaxyList')
  .filter(column=>['uid','createtime','site'].includes(column)).concat('site_id').join(',');
const GALAXY_IMPORT_UID_COLUMNS=galaxyReadColumnsFor('GalaxyUidRead')
  .concat(['site_id']).filter((column,index,all)=>all.indexOf(column)===index).join(',');
// Imported Anchor keys are semantic matches, not UNIQUE constraints.
// Report unresolved duplicate UIDs without choosing an arbitrary winner.
function importAnchorConflictSummary(...results){
  const conflicts=results.flatMap(result=>Array.isArray(result?.conflicts)?result.conflicts:[]);
  if(!conflicts.length)return '';
  const sample=conflicts.slice(0,5).map(row=>
    (row.type==='date'?'日期 '+String(row.date||''):
      row.type==='point'?'地點 '+String(row.place||''):
      row.type==='source'?'來源 '+String(row.site||row.alias||''):
        '媒體 '+String(row.type||'')+' '+String(row.url||row.uid||'未提供網址'))+
    (row.saved_uids?.length?'，候選 UID '+row.saved_uids.slice(0,5).join(',')+
      (row.saved_uids.length>5?'…':''):'，缺少唯一識別'));
  return '；Anchor 比對衝突 '+conflicts.length.toLocaleString()+
    ' 組，已保留待人工核對：'+sample.join('、')+
    (conflicts.length>5?' 等':'')+'。';
}
const ZIP_LAYOUT_KEYS=Object.freeze({
  'conversation-tree':'conversationTree','message-list':'messageList','post-list':'postList',
  activity:'activity',media:'media',table:'table','structured-records':'records',document:'document'
});
const ZIP_FIELD_KEYS=Object.freeze(['id','text','author','time','relation','attachment','collection']);
const ZIP_SOURCE_NAMES=Object.freeze({chatgpt:'ChatGPT',claude:'Claude',gemini:'Gemini',grok:'Grok',copilot:'Microsoft Copilot',perplexity:'Perplexity', 'meta-ai':'Meta AI',facebook:'Facebook',messenger:'Messenger',instagram:'Instagram',threads:'Threads',whatsapp:'WhatsApp',x:'X / Twitter',telegram:'Telegram',discord:'Discord',line:'LINE',slack:'Slack',teams:'Microsoft Teams',snapchat:'Snapchat',wechat:'WeChat',tiktok:'TikTok',reddit:'Reddit',linkedin:'LinkedIn',pinterest:'Pinterest',youtube:'YouTube','google-takeout':'Google Takeout'});
function iso(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}

function normalizeJsonImportEntry(entry,source,fieldMap={},t,manualModel=false){
  const row=entry?.raw||entry||{};
  const declared=sourceImportModel(source);
  const detected=sourceImportModel('',row);
  // A user's explicit model selection must not be silently replaced by the
  // JSON object_type. A mismatch is a visible import error, not a guessed site.
  if(manualModel&&declared&&detected&&declared.label!==detected.label)
    return {record:null,error:'所選來源 '+declared.label+
      ' 與資料 object_type 所屬的 '+detected.label+' 不一致，請重新選擇。'};
  const sourceModel=sourceImportModel(source,row);
  // A recognized object_type is authoritative over a misleading filename;
  // no SiteAnchor record, UID or permission is synthesized.
  const selectedSource=sourceModel?.label||source;
  const value=field=>mappedImportValue(row,field,fieldMap,sourceModel||selectedSource);
  const isFacebook=String(selectedSource||'').trim().toLowerCase()==='facebook';
  const isThreads=String(selectedSource||'').trim().toLowerCase()==='threads';
  const isInstagram=String(selectedSource||'').trim().toLowerCase()==='instagram';
  // The generic "place" alias can hold a Meta object. Only actual text
  // belongs in Galaxy.location; never stringify [object Object].
  const mappedPlace=value('location');
  const placeText=typeof mappedPlace==='string'?mappedPlace:
    (isFacebook?facebookBackupPlace(row):'');
  const place=repairMojibakeText(placeText).trim();
  const explicitCheckin=isFacebook&&Boolean(facebookBackupPlace(row)||row.__importCheckin===true);
  const facebookText=isFacebook?facebookBackupPostText(row):'';
  const threadsText=isThreads?(row.media?.find?.(item=>typeof item?.title==='string')?.title||
    row.string_list_data?.find?.(item=>typeof item?.value==='string')?.value||''):'';
  const content=normalizeGalaxyContent(value('content')||facebookText||threadsText||
    (isFacebook&&place?'Facebook 打卡地點：'+place:''));
  const rawTitle=repairMojibakeText(value('title')).trim();
  const sourcePlace=place;
  const facebookPlace=isFacebook?facebookPostPlace(row):null;
  const importedCoordinates=row.__importCoordinates
    ?extractImportCoordinates(row.__importCoordinates)
    :isFacebook?facebookPlace?.__importCoordinates:extractImportCoordinates(row);
  const importPlaceName=String(row.__importPlaceName||facebookPlace?.location||'').trim();
  const importPlaceAddress=String(row.__importPlaceAddress||facebookPlace?.address||'').trim();
  const importPlaceUrl=String(row.__importPlaceUrl||facebookPlace?.placeUrl||'').trim();
  const rawDate=value('createtime')||
    (isThreads?row.media?.find?.(item=>item?.creation_timestamp)?.creation_timestamp:null)||
    (isFacebook?facebookBackupTimestamp(row):null);
  const originalCreatedAt=parseImportCreatedTime(rawDate)||extractImportCreatedAt(row);
  const editedAt=originalCreatedAt?null:extractImportUpdatedAt(row);
  // A source edit timestamp is fallback evidence only; rows with neither
  // source time are assigned a distinct database-safe time before insertion.
  const createdAt=originalCreatedAt||editedAt||null;
  const importTimeSource=originalCreatedAt?'creation':editedAt?'update':'missing';
  // Platform-owned IDs are resolved by the selected source ZModel, not by
  // another Meta-specific fallback order in the UI.
  const originalSiteId=value('site_id');
  // On social imports the source ID is optional metadata; Galaxy UID is
  // generated locally by the importer and never derived from source content.
  const uid=String(((isFacebook||isThreads||isInstagram)&&entry?.import_uid)||
    value('uid')||entry?.import_uid||createUid8()).trim();
  const rawUrl=String(value('url')||'').trim();
  const visualGalaxyRow=Boolean(content&&publicVisualUrl(rawUrl)&&
    (row.__visualGalaxy===true||
      ['image','video'].includes(String(value('media_type')||'').trim().toLowerCase())));
  const mediaCandidates=[value('media'),value('media_link'),
    ...(isArchiveMediaUrl(rawUrl)&&!visualGalaxyRow?[rawUrl]:[])]
    .filter(item=>item!==''&&item!==undefined&&item!==null);
  let mediaRecords=[],mediaRefs=[],mediaWarning='';
  const importedRuneReferences=value('rune_references');
  const runeResultText=runeDrawText(importedRuneReferences);
  try{
    for(const item of mediaCandidates){
      const media=normalizeImportMedia(item,{title:rawTitle,createtime:createdAt,
        location:sourcePlace,article_uid:uid,defaultMediaType:String(value('media_type')||'')});
      mediaRecords.push(...media.records);
      mediaRefs.push(...media.references);
    }
    const seenMediaKeys=new Set();
    mediaRecords=mediaRecords.filter(record=>{
      const key=record.uid?'id:'+record.uid:(record.url?JSON.stringify([record.url,record.media_type]):null);
      if(!key)return true;
      if(seenMediaKeys.has(key))return false;
      seenMediaKeys.add(key);return true;
    });
    mediaRefs=[...new Set(mediaRefs)];
    // Unsupported document/object types must not abort an otherwise valid
    // article halfway through MediaAnchor writes. Report them in the preview.
    const rejected=new Set();
    mediaRecords=mediaRecords.filter(record=>{
      try{canonicalMediaAnchorType(record.media_type,record.url);return true;}
      catch{rejected.add(String(record.media_type||'unknown'));return false;}
    });
    if(rejected.size)mediaWarning='附件型別不支援，已略過：'+[...rejected].join('、');
    // A text article may carry a top-level card draw, even when the import
    // did not provide a nested media array. Attach one media record to its UID.
    if(content&&runeResultText)mediaRecords.push({
      __article_uid:uid,media_type:'rune',title:'抽牌結果',
      url:null,description:runeResultText,createtime:createdAt,location:sourcePlace||null
    });
  }catch(error){return {record:null,error:String(error.message||error)}}
  if(!content){
    // Pages containing images but no authored text belong to MediaAnchor,
    // not a fabricated Galaxy article. Keep only real accessible URLs.
    const independent=mediaRecords.filter(record=>Boolean(record.url))
      .map(({__article_uid:unused,...media})=>({...media,location:null}));
    if(independent.length)return {record:null,error:'',mediaOnlyRecords:independent,
      warning:mediaWarning};
    const type=String(value('media_type')||(runeResultText?'rune':'')).trim();
    const url=String(value('url')||'').trim();
    if(type){
      try{canonicalMediaAnchorType(type,url);}catch(error){
        return {record:null,error:'來源只有媒體物件，但型別不支援：'+type+
          '。'+String(error?.message||error)};
      }
      const rawId=String(row.uid||'').trim();
      if(rawId&&!/^[A-Z0-9]{8}$/i.test(rawId))return {record:null,error:t('uiExtra.importUI.invalidMediaId')};
      return {record:null,error:'',mediaOnlyRecord:{
        ...(rawId?{uid:rawId}:{}),
        __article_uid:String(value('galaxy_link')||'').trim()||null,
        location:sourcePlace||null,
        media_type:type,title:rawTitle||(type==='rune'?'抽牌結果':null),url:url||null,
        description:type==='rune'?(runeDrawText(value('description'))||runeResultText):String(value('description')||'').trim(),
        createtime:createdAt,
        ...(type!=='rune'&&runeResultText?{rune_references:importedRuneReferences}:{})
      }};
    }
    return {record:null,error:t('uiExtra.importUI.invalidNoBody')};
  }
  if([content,rawTitle,sourcePlace].some(hasIrrecoverableEncoding))return {record:null,error:t('uiExtra.importUI.invalidEncoding')};
  if(uid.length!==8)return {record:null,error:t('uiExtra.importUI.invalidUid')};
  const visibility=value('searchable');
  const searchable=!(visibility===false||visibility===0||String(visibility).toLowerCase()==='false'||String(visibility)==='0');
  // Convert external archive flags once at the import boundary.
  // No legacy Galaxy model or packed able payload reaches the writer.
  const statisticsEnabled=value('statistics_able')!==false&&
    String(value('statistics_able')).toLowerCase()!=='false'&&
    searchable&&!isPureUrlContent(content);
  const record={
    uid,
    // Threads has no native post title; titleless imports use the first 10 Unicode characters.
    title:(isThreads||!rawTitle)?Array.from(content).slice(0,10).join(''):resolveGalaxyTitle(rawTitle,content),
    content,
    createtime:createdAt,
    __importTimeSource:importTimeSource,
    location:sourcePlace||null,
    ...(explicitCheckin?{__importCheckin:true}:{}),
    ...(importedCoordinates?{__importCoordinates:importedCoordinates,
      ...(importPlaceName?{__importPlaceName:importPlaceName}:{}),
      ...(importPlaceAddress?{__importPlaceAddress:importPlaceAddress}:{}),
      ...(importPlaceUrl?{__importPlaceUrl:importPlaceUrl}:{})}:{}),
    ...galaxyAble({
      site:String(selectedSource||'').trim(),
      site_id:String(originalSiteId||'').trim(),
      title:rawTitle,
      statics:statisticsEnabled,culture:statisticsEnabled,
      search:searchable,trace:searchable&&statisticsEnabled,
      list:searchable,keyword:searchable&&statisticsEnabled,
      extract:true,others:true,
      ...Object.fromEntries(['statics','culture','search','trace','list','keyword','extract','others']
        .map(key=>[key,value(key)]).filter(([,v])=>v!==undefined&&v!==null&&v!==''))
    }),
    source_id:String(value('source_id')||'').trim()||null,
    target_id:normalizeRelationIds(value('target_id')),
    site_id:String(originalSiteId||'').trim()||null,
    ref_id:String(value('ref_id')||'').trim()||null,
    url:visualGalaxyRow?publicVisualUrl(rawUrl):
      !isArchiveMediaUrl(rawUrl)&&!importMapUrlCoordinates(rawUrl)?rawUrl||null:null,
    ...(mediaRecords.some(item=>/^https?:\/\//i.test(String(item.url||''))&&
      String(item.url||'').trim()!==(visualGalaxyRow?publicVisualUrl(rawUrl):
        !isArchiveMediaUrl(rawUrl)&&!importMapUrlCoordinates(rawUrl)?rawUrl||null:null))
      ?{media_link:[...new Set(mediaRecords.map(item=>String(item.url||'').trim())
        .filter(url=>/^https?:\/\//i.test(url)&&
          url!==(visualGalaxyRow?publicVisualUrl(rawUrl):
            !isArchiveMediaUrl(rawUrl)&&!importMapUrlCoordinates(rawUrl)?rawUrl||null:null)))]}:{}),
    site:String(selectedSource||'').trim()
  };
  return {record,mediaRecords,mediaRefs,error:'',warning:mediaWarning};
}

const IMPORT_FORMAT_FIELDS=Object.freeze([
  'uid','site_id','content','title','createtime','location',
  'url','source_id','target_id','ref_id','searchable','statistics_able',
  'media_link','media','media_type','galaxy_link','description','rune_references'
]);

// Preview text shows each web address as a short link instead of the raw URL.
// Plain text is cut at `limit` characters; a link never counts toward the limit.
const IMPORT_URL_PATTERN=/(https?:\/\/[^\s<>"'\u3000-\u303F\uFF00-\uFFEF]+)/g;
function LinkedImportText({text,limit=Infinity}){
  const parts=String(text??'').split(IMPORT_URL_PATTERN);
  let left=limit,cut=false;
  const out=[];
  parts.forEach((part,index)=>{
    if(index%2){out.push(<a key={index} href={part} target="_blank" rel="noopener noreferrer">連結</a>);return;}
    if(!part||cut)return;
    if(part.length>left){out.push(part.slice(0,left)+'…');cut=true;left=0;return;}
    out.push(part);left-=part.length;
  });
  return <>{out}</>;
}

function ImportFormatSettings({format,onChange,disabled=false}){
  const t=useUiText();
  const update=(key,value)=>onChange({...format,[key]:value});
  const updateField=(key,value)=>onChange({...format,fields:{...format.fields,[key]:value}});
  return <details className="loc-bubble scope-import-format">
    <summary><UiText id="uiExtra.importUI.formatSummary"/><span className="scope-import-format-mark" aria-hidden="true"/></summary>
    <div className="scope-management-fields">
      <label><UiText id="uiExtra.importUI.recordPath"/>
        <input disabled={disabled} value={format.recordPath} onChange={e=>update('recordPath',e.target.value)} placeholder={t('uiExtra.importUI.recordPathHint')}/>
      </label>
    </div>
    <div className="scope-management-fields">
      {IMPORT_FORMAT_FIELDS.map(key=><label key={key}>{t('uiExtra.importUI.field.'+key)}
        <input disabled={disabled} value={format.fields[key]||''}
          onChange={e=>updateField(key,e.target.value)}
          placeholder={IMPORT_FIELD_ALIASES[key].join(', ')}/>
      </label>)}
    </div>
  </details>;
}

// Fixed, authenticated import lookup: only original platform IDs or source
// creation instants are supplied. The trusted SQL Runtime owns both queries;
// no article scan, SQL expression, table selection or candidate cap is exposed.
async function readImportIdentityCandidates({scopeId,site,action,keys,onPage}={}){
  const field=action==='import_site_id_candidates'?'p_site_ids':
    action==='import_created_at_candidates'?'p_instants':null;
  if(!field||!Array.isArray(keys)||typeof onPage!=='function')
    throw new Error('匯入識別查詢參數無效');
  const pageSize=60;
  for(let offset=0;offset<keys.length;offset+=80){
    const chunk=keys.slice(offset,offset+80);
    let after=null;
    for(;;){
      const {data,error}=await dbAuthClient.schema('silver').managedAction(action,{
        p_scope_id:scopeId,p_site:site,[field]:chunk,
        ...(after?{p_after_uid:after}:{}),p_limit:pageSize
      });
      if(error)throw new Error(error.message||'匯入識別查詢失敗');
      const rows=data?.rows,next=data?.nextCursor??null;
      if(!Array.isArray(rows)||rows.length>pageSize||
        rows.some(row=>!row||typeof row.uid!=='string'||
          !/^[A-Za-z0-9]{8}$/.test(row.uid))||
        next!==null&&(typeof next!=='string'||next!==rows.at(-1)?.uid||
          next===after)||(!rows.length&&next!==null))
        throw new Error('匯入識別查詢游標或回傳資料無效');
      if(rows.length)onPage(rows);
      if(next===null)break;
      after=next;
    }
  }
}

// A GET .in() filter has a URL budget, unlike POST imports.
// Count and page each query until all matched rows are returned.
async function readExistingByIds(table,columns,column,values,message,onPage){
  const records=[],orderColumn='uid';
  // Internal import match pages use the common SQL return baseline;
  // these are not UI article UID lists (whose visible pages stay at 100).
  const pageSize=MAX_ROWS;
  for(const batch of urlSafeInBatches(values,column)){
    for(let offset=0;;){
      const {data,error}=await dbAuthRelation(table).select(columns)
        .in(column,batch).order(orderColumn,{ascending:true})
        .range(offset,offset+pageSize-1);
      if(error)throw new Error(error.message||message);
      const rows=data||[];
      if(!rows.length)break;
      if(onPage)await onPage(rows);
      else records.push(...rows);
      offset+=rows.length;
      if(rows.length<pageSize)break;
    }
  }
  return records;
}

// Shared idempotent media attachment write for standard file imports.
// All records are bound by original article UID; no full-table scan or recursive discovery.
async function readImportMediaCandidates(scopeId,anchor,uids=[],urls=[],message='媒體讀取失敗'){
  // MediaAnchor UID is exact PK data; never normalize a malformed ID.
  const ids=[...new Set(uids.map(value=>String(value??'')).filter(Boolean))];
  // Media URL identity is literal: whitespace is significant.
  const links=[...new Set(urls.map(value=>String(value??'')).filter(Boolean))];
  if(scopeId==='local'){
    if(links.length)throw new Error('本機媒體 URL 去重尚無 SQL 查詢能力，已停止匯入避免重複資料。');
    const rows=await readExistingByIds(anchor,MEDIA_ANCHOR_COLUMNS,'uid',ids,message);
    return rows.filter(row=>ANCHOR_TYPE_GROUPS.media.includes(row.type)).map(mediaAnchorProjection);
  }
  const out=new Map(),pageSize=200;
  for(let offset=0;offset<Math.max(ids.length,links.length);offset+=200){
    const uidBatch=ids.slice(offset,offset+200);
    const urlBatch=links.slice(offset,offset+200);
    let afterUid=null;
    const seenBatch=new Set();
    for(;;){
      const {data,error}=await dbAuthClient.schema('silver').managedAction(
        'media_anchor_candidates',{p_scope_id:scopeId,p_uids:uidBatch,
          p_urls:urlBatch,p_after_uid:afterUid,p_limit:pageSize});
      if(error)throw new Error(error.message||message);
      if(!Array.isArray(data)||data.length>pageSize)
        throw new Error('MediaAnchor lookup response invalid');
      for(const row of data){
        const uid=String(row?.uid||'');
        if(!/^[A-Za-z0-9]{8}$/.test(uid)||seenBatch.has(uid)||
            !ANCHOR_TYPE_GROUPS.media.includes(row?.type))
          throw new Error('MediaAnchor lookup contains duplicate or invalid UID/type');
        seenBatch.add(uid);
        const previous=out.get(uid);
        if(previous&&JSON.stringify(previous)!==JSON.stringify(row))
          throw new Error('MediaAnchor candidate changed across import pages; retry safely');
        out.set(uid,row);
        afterUid=uid;
      }
      // A full page is not the end: read every collision UID, regardless of
      // how many media records share the same URL and persisted ZModel type.
      if(data.length<pageSize)break;
    }
  }
  return [...out.values()];
}

// Existing import idempotency is preserved with one authorized, bounded
// Kysely lookup for UID and attr.url candidates; no Galaxy Media table.
async function syncImportedMedia({normalized=[],mediaOnly=[],extraLinks=[],knownArticleIds=new Map(),scopeId,galaxy,mediaAnchor,t,onProgress}={}){
      // Media-only imports and embedded media use the one typed MediaAnchor table.
      // Attach only to article UIDs established by the import plan.
      const originalPlans=normalized.flatMap(item=>{
        const sourceUid=item.record?.uid;
        const owner=knownArticleIds.get(sourceUid);
        return (owner?(item.mediaRecords||[]):[]).map(record=>({...record,__article_uid:owner}));
      }).concat(mediaOnly);
      // One legacy rune_references field becomes its own runes media record.
      // Keep the original media record, URL, title and description unchanged.
      // Never duplicate the article in Galaxy just to store a card spread.
      const plans=originalPlans.flatMap(source=>{
        const {rune_references,media_type:legacyType,...rest}=source;
        const record={...rest,type:canonicalMediaAnchorType(source.type||legacyType,source.url)};
        if(rune_references==null||rune_references===''||
            JSON.stringify(rune_references)==='[]'||JSON.stringify(rune_references)==='{}')
          return [record];
        const content=runeDrawText(rune_references);
        if(record.type==='rune'){
          return [{...record,title:record.title||'抽牌結果',description:runeDrawText(record.description)||content}];
        }
        if(!record.__article_uid)throw new Error('抽牌結果必須對應 Galaxy 文章 UID');
        return [record,{
          __article_uid:record.__article_uid,type:'rune',title:'抽牌結果',
          url:null,description:content,createtime:record.createtime,location:record.location
        }];
      });
      onProgress?.({stage:'核對既有媒體',completed:0,total:0});
      const explicitIds=[...new Set([...plans.map(record=>record.uid).filter(Boolean),...normalized.flatMap(item=>item.mediaRefs||[])])];
      const candidateUrls=[...new Set(plans.map(row=>row.url).filter(Boolean))];
      // One bounded UID-or-URL candidate query per chunk; avoid scanning
      // the same MediaAnchor twice during a single import plan.
      const existingMedia=await readImportMediaCandidates(scopeId,mediaAnchor,
        explicitIds,candidateUrls,t('uiExtra.importUI.mediaIdCompareFailed'));
      const mediaKey=row=>{
        const url=String(row.url??'');
        return url?JSON.stringify([url,String(row.type??'')])
          :(row.uid?'id:'+row.uid:null);
      };
      const byKey=new Map(),ambiguousMediaKeys=new Map();
      const byId=new Map(existingMedia.map(row=>[String(row.uid),row]));
      for(const row of existingMedia){
        const key=mediaKey(row);
        if(!key)continue;
        if(ambiguousMediaKeys.has(key)){
          ambiguousMediaKeys.get(key).add(String(row.uid));
        }else if(byKey.has(key)&&String(byKey.get(key).uid)!==String(row.uid)){
          ambiguousMediaKeys.set(key,new Set([String(byKey.get(key).uid),String(row.uid)]));
          byKey.delete(key);
        }else byKey.set(key,row);
      }
      const mediaConflicts=[],reportedMediaConflicts=new Set();
      const reportMediaConflict=(key,record,uids)=>{
        if(reportedMediaConflicts.has(key))return;
        reportedMediaConflicts.add(key);
        mediaConflicts.push({type:record.type||null,url:record.url||null,
          uid:record.uid||null,saved_uids:[...uids].sort()});
      };
      // URL-less media stay standalone; no inferred article UID relationship.
      const createMedia=[],pendingMediaUids=new Set(),related=new Map(),seenMedia=new Set(),resolvedIds=new Map();
      const mediaSizer=createImportBatchSizer();
      let created=0;
      const flushNewMedia=async()=>{
        if(!createMedia.length)return;
        const count=createMedia.length,started=Date.now();
        const characters=createMedia.reduce((sum,row)=>sum+JSON.stringify(row).length,0);
        await writeImportBatches(createMedia,{
          writeBatch:batch=>insertImportRows(mediaAnchor,batch.map(mediaAnchorRecord)),
          onProgress:p=>onProgress?.({stage:'新增媒體紀錄',completed:created+p.completed,total:created+count})
        });
        created+=count;
        createMedia.length=0;
        pendingMediaUids.clear();
        mediaSizer.observe(count,Date.now()-started,characters);
      };
      function attach(uid,url){
        const mediaUrl=String(url||'').trim();
        if(!uid||!/^https?:\/\//i.test(mediaUrl))return;
        if(!related.has(uid))related.set(uid,new Set());
        related.get(uid).add(mediaUrl);
      }
      for(const item of normalized){
        const uid=knownArticleIds.get(item.record?.uid);
        for(const mediaId of item.mediaRefs||[]){
          const saved=byId.get(mediaId);
          if(!saved)throw new Error(t('uiExtra.importUI.missingMediaReference',{id:mediaId}));
          if(saved.url)attach(uid,saved.url);
        }
      }
      for(const raw of plans){
        const owner=String(raw.__article_uid||'').trim();
        const record={...raw};delete record.__article_uid;
        if(String(record.location||'').trim()&&!owner)
          throw new Error('未連結文章的媒體地點無法儲存到 MediaAnchor；請先建立文章／LocationAnchor。');
        const key=mediaKey(record);
        // UID is authoritative if it exists; URL+type or article evidence
        // cannot select one among several persisted MediaAnchor UIDs.
        const exact=record.uid?byId.get(String(record.uid)):null;
        if(!exact&&key&&ambiguousMediaKeys.has(key)){
          reportMediaConflict('url:'+key,record,ambiguousMediaKeys.get(key));
          continue;
        }
        const known=exact||(key?byKey.get(key):null);
        if(known){
          if(record.uid&&String(known.type||'')!==String(record.type||''))
            throw new Error('媒體 UID 已存在，但媒體類型不同：'+record.uid);
          if(record.uid&&known.url&&record.url&&String(known.url)!==String(record.url))
            throw new Error('媒體 UID 已存在，但網址不同：'+record.uid);
          // Existing media keep their saved url; the url is only written on insert.
          if(record.uid)resolvedIds.set(String(record.uid),String(known.uid));
          if(known.url)attach(owner,known.url);continue;
        }
        if(key&&seenMedia.has(key))continue;
        if(key)seenMedia.add(key);
        const mediaId=record.uid||createUid8();
        if(!mediaId)throw new Error(t('uiExtra.importUI.mediaUuidUnavailable'));
        record.uid=mediaId;
        createMedia.push(record);pendingMediaUids.add(String(mediaId));
        if(key)byKey.set(key,record);byId.set(mediaId,record);
        if(record.url)attach(owner,record.url);
        if(createMedia.length>=mediaSizer.size)await flushNewMedia();
      }
      await flushNewMedia();
      for(const link of extraLinks){
        const uid=knownArticleIds.get(String(link.uid||'').trim());
        const mediaId=resolvedIds.get(String(link.media_uid||''))||String(link.media_uid||'');
        if(uid&&byId.get(mediaId)?.url)attach(uid,byId.get(mediaId).url);
      }
      let connected=0,checkedLinks=0;
      const linkedUids=[...related.keys()];
      const linkSizer=createImportBatchSizer();
      let linkQueue=[],linkBytes=0;
      const flushMediaLinks=async()=>{
        if(!linkQueue.length)return;
        const count=linkQueue.length,started=Date.now();
        const characters=linkQueue.reduce((sum,row)=>sum+JSON.stringify(row).length,0);
        const result=await updateImportRows(galaxy,linkQueue);
        connected+=result.count;
        linkQueue=[];linkBytes=0;
        linkSizer.observe(count,Date.now()-started,characters);
      };
      onProgress?.({stage:'讀取文章媒體連結',completed:0,total:linkedUids.length});
      await readExistingByIds(galaxy,'uid,url,media_link','uid',linkedUids,
        t('uiExtra.importUI.mediaLinkReadFailed'),async page=>{
          for(const row of page){
            const uid=String(row.uid||'').trim();
            const prior=Array.isArray(row.media_link)?row.media_link:[];
            const delta=planImportMediaUrlLinks(prior,related.get(uid)||[],row.url);
            if(delta.patches.length){
              const update={uid,...delta.changes};
              const bytes=linkSizer.byteSize(update);
              if(linkSizer.shouldFlush(linkQueue.length,linkBytes,bytes))
                await flushMediaLinks();
              linkQueue.push(update);linkBytes+=bytes;
              if(linkSizer.shouldFlush(linkQueue.length,linkBytes))
                await flushMediaLinks();
            }
            checkedLinks++;
          }
          onProgress?.({stage:'更新文章媒體連結',completed:checkedLinks,total:linkedUids.length});
        });
      await flushMediaLinks();

  return {created,connected,resolvedIds,conflicts:mediaConflicts};
}


// Images are independent Galaxy rows linked by source_id, not media_link.
async function syncImportedVisualGalaxies({
  records=[],knownArticleIds=new Map(),articlesByUid=new Map(),galaxy,onProgress
}={}){
  const images=visualGalaxyCandidates(records,{
    resolveOwner:uid=>knownArticleIds.get(uid)||(articlesByUid.has(uid)?uid:''),
    articlesByUid
  });
  if(!images.length)return {created:0,existing:0,conflicts:0};
  const wanted=new Map(images.map(row=>[JSON.stringify([row.source_id,row.url]),row]));
  const saved=new Map(),urls=[...new Set(images.map(row=>row.url))];
  let examined=0;
  for(const batch of urlSafeInBatches(urls,'url')){
    let cursor='';
    for(;;){
      let query=dbAuthRelation(galaxy).select('uid,source_id,url')
        .in('url',batch).order('uid',{ascending:true}).limit(MAX_ROWS);
      if(cursor)query=query.gt('uid',cursor);
      const {data,error}=await query;
      if(error)throw Error('圖片／影片 Galaxy URL 查詢失敗：'+error.message);
      const rows=data||[];
      if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw Error('圖片／影片 Galaxy 查詢回傳不完整');
      for(const row of rows){
        const key=JSON.stringify([String(row.source_id||''),String(row.url||'')]);
        if(!wanted.has(key))continue;
        if(!saved.has(key))saved.set(key,new Set());
        saved.get(key).add(String(row.uid||''));
      }
      if(rows.length<MAX_ROWS)break;
      const next=String(rows.at(-1)?.uid||'');
      if(!/^[A-Za-z0-9]{8}$/.test(next)||next<=cursor)
        throw Error('圖片／影片 Galaxy URL 游標未前進');
      cursor=next;
    }
    examined+=batch.length;
    onProgress?.({stage:'核對圖片／影片 Galaxy',completed:examined,total:urls.length});
  }
  const inserts=[],offsets=new Map();
  let existing=0,conflicts=0;
  for(const row of images){
    const key=JSON.stringify([row.source_id,row.url]),found=saved.get(key);
    if(found?.size===1){existing++;continue;}
    if(found?.size>1){conflicts++;continue;}
    const time=Date.parse(String(row.createtime||''));
    const basis=Number.isFinite(time)?time:Date.now();
    const offset=offsets.get(basis)||0;
    offsets.set(basis,offset+1);
    inserts.push({
      uid:createUid8(),source_id:row.source_id,url:row.url,
      title:row.title,content:row.content,site:row.site,
      createtime:new Date(basis+offset+1).toISOString(),
      ...galaxyAble({site:row.site,statics:false,culture:false,search:false,
        trace:false,list:false,keyword:false,extract:false,others:false})
    });
  }
  let created=0,processed=0,pending=[],pendingBytes=0;
  const imageSizer=createImportBatchSizer();
  const flushImageBatch=async()=>{
    if(!pending.length)return;
    const batch=pending,started=Date.now();
    const result=await insertImportBatches(batch,{
      batchSize:imageSizer.size,
      verifyUidConflict:async uid=>{
        const {data,error}=await dbAuthRelation(galaxy).select('uid').eq('uid',uid).limit(1);
        if(error)throw Error('圖片／影片 UID 比對失敗：'+error.message);
        return Boolean(data?.length);
      },
      writeBatch:rows=>insertImportRows(galaxy,rows)
    });
    created+=result.inserted;conflicts+=result.conflicts;
    processed+=batch.length;pending=[];pendingBytes=0;
    imageSizer.observe(batch.length,Date.now()-started,
      batch.reduce((sum,row)=>sum+JSON.stringify(row).length,0));
    onProgress?.({stage:'新增圖片／影片 Galaxy',completed:processed,total:inserts.length});
  };
  for(const row of inserts){
    const bytes=imageSizer.byteSize(row);
    if(imageSizer.shouldFlush(pending.length,pendingBytes,bytes))
      await flushImageBatch();
    pending.push(row);pendingBytes+=bytes;
    if(imageSizer.shouldFlush(pending.length,pendingBytes))
      await flushImageBatch();
  }
  await flushImageBatch();
  return {created,existing,conflicts};
}

function UniversalImport({scopeId,format,onFormatChange}) {
  const {locale}=useUiLocale();
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const nativeLocal=scopeId==='local'&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios';
  const account=useAccount({enabled:!nativeLocal});
  const resourceCache=useResourceCache();
  const [fileName,setFileName]=useState('');
  const [archiveDetection,setArchiveDetection]=useState(null);
  const [archiveSummary,setArchiveSummary]=useState(null);
  const [archiveEvidence,setArchiveEvidence]=useState([]);
  const [geoPlaceCandidates,setGeoPlaceCandidates]=useState([]);
  const [rows,setRows]=useState([]);
  const [queue,setQueue]=useState([]);
  const [queueIndex,setQueueIndex]=useState(0);
  const [source,setSource]=useState('');
  // Explicit source-model selection is primary; filenames are only hints.
  const [sourceSelection,setSourceSelection]=useState('');
  // Historic CMS exports (including pre-2013 MSN archives) are not a recent feed.
  // Import the full file unless the operator explicitly chooses a time filter.
  const [timeRange,setTimeRange]=useState('all');
  const timeWindow=useMemo(()=>importTimeRangeWindow(timeRange),[timeRange,fileName]);
  const sourceCategoriesEnabled=!nativeLocal&&Boolean(account.user)&&account.canLocAccessSync('scope',scopeId);
  const sourceCategories={data:sourceCategoriesEnabled?PUBLISHED_SOURCE_CATEGORIES:undefined};
  const sourceOptions=[...new Set([...(sourceCategories.data?.system||[]),...(sourceCategories.data?.personal||[]),...IMPORT_SOURCE_MODEL_LABELS])];
  const canonicalSource=value=>canonicalImportSourceName(value,sourceCategories.data?.system||[],sourceCategories.data?.personal||[]);
  const [importLocale,setImportLocale]=useState('zh-Hant');
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [parsingJson,setParsingJson]=useState(false);
  const fileLoadGeneration=useRef(0);
  const jsonReadAbort=useRef(null);
  useEffect(()=>()=>{
    // Releasing the import page also releases its pending JSON Worker.
    ++fileLoadGeneration.current;
    jsonReadAbort.current?.abort();
    jsonReadAbort.current=null;
  },[]);
  // A failed write must not retain decoded ZIP/JSON article arrays in React.
  // Keep only the original File reference for an explicit, revalidated retry.
  const [reparseRequired,setReparseRequired]=useState(false);
  const [checkpointHint,setCheckpointHint]=useState(null);
  const importOwnerId=String(nativeLocal?'local':account.user?.id||'').trim();
  const checkpointStorage=()=>{
    // Tiny receipts survive an accidental tab/app restart. No article bodies,
    // tokens, raw ZIP data or file handles are written into browser storage.
    try{return window.localStorage;}catch{return null;}
  };
  // One event-driven progress snapshot, no additional query, timer or cache.
  const [progressStore]=useState(createImportProgressStore);
  const progress=useSyncExternalStore(progressStore.subscribe,
    progressStore.getSnapshot,progressStore.getServerSnapshot);
  const setProgress=progressStore.set;
  const [summaryRefreshing,setSummaryRefreshing]=useState(false);
  const [summaryMessage,setSummaryMessage]=useState('');
  const [summaryError,setSummaryError]=useState(false);
  const suggested=useMemo(()=>inferImportSourceFromFilename(fileName),[fileName]);
  const suggestedModel=sourceImportModel(suggested)?.label||'';
  const chooseSource=value=>{
    if(busy)return;
    setSourceSelection(value);
    setSource(value==='__custom__'?'':value);
    // Changing the selected source changes the record collection itself,
    // not just the preview field aliases. Reparse the queued original file
    // only for standalone JSON; ZIP uses verified per-entry source identity.
    const current=queue[queueIndex];
    if(current&&value&&!archiveDetection)
      void loadQueuedFile(current,queueIndex,queue.length,importLocale,
        format.recordPath,value);
  };
  const deferredSource=useDeferredValue(source);
  const [analysisSnapshot,setAnalysisSnapshot]=useState(null);
  const [analysisProgress,setAnalysisProgress]=useState({completed:0,total:0});
  // Only the current file, source ZModel and user field overrides can unlock
  // writing. An older completed preview is never valid for a newer selection.
  const analysisCurrent=Boolean(analysisSnapshot&&
    analysisSnapshot.rows===rows&&analysisSnapshot.source===deferredSource&&
    analysisSnapshot.fields===format.fields&&analysisSnapshot.locale===locale&&
    analysisSnapshot.archive===archiveDetection&&
    analysisSnapshot.categories===sourceCategories.data&&
    analysisSnapshot.selection===sourceSelection);
  const rawAnalysis=analysisCurrent?analysisSnapshot.result:EMPTY_IMPORT_ANALYSIS;
  useEffect(()=>{
    let cancelled=false,task=null,index=0;
    const normalized=[],valid=[],mediaOnly=[],invalid=[],warnings=[];
    setAnalysisSnapshot(null);
    setAnalysisProgress({completed:0,total:rows.length});
    if(!archiveDetection&&!sourceSelection)return;
    const selected=deferredSource.trim();
    const system=sourceCategories.data?.system||[];
    const personal=sourceCategories.data?.personal||[];
    const manual=Boolean(sourceSelection&&sourceSelection!=='__custom__'&&!archiveDetection);
    const process=()=>{
      if(cancelled)return;
      // Do not block the browser main thread for the entire archive. Source
      // mapping is still the existing ZModel projection, not a new parser.
      const boundary=Math.min(rows.length,index+160);
      for(;index<boundary;index++){
        const entry=rows[index];
        try{
          const embedded=archiveDetection?String(entry?.raw?.site||'').trim():'';
          const entrySource=canonicalImportSourceName(embedded||selected,system,personal);
          let item;
          if(embedded&&sourceSelection&&sourceSelection!=='__custom__'&&
              selected!=='Mixed'&&entrySource!==canonicalImportSourceName(sourceSelection,system,personal)){
            item={record:null,error:'所選來源 '+sourceSelection+
              ' 與封存檔記錄來源 '+entrySource+' 不一致，請核對來源。'};
          }else item=normalizeJsonImportEntry(entry,entrySource,format.fields,t,manual);
          if(item.record){normalized.push(item);valid.push(item.record);}
          if(item.mediaOnlyRecord)mediaOnly.push(item.mediaOnlyRecord);
          if(Array.isArray(item.mediaOnlyRecords))mediaOnly.push(...item.mediaOnlyRecords);
          if(item.error)invalid.push(item);
          if(item.warning)warnings.push(item.warning);
        }catch(error){
          invalid.push({record:null,error:'第 '+(index+1)+' 筆來源資料無法對應：'+
            String(error?.message||error)});
        }
      }
      if(cancelled)return;
      if(index<rows.length){
        if(index%960<160)setAnalysisProgress({completed:index,total:rows.length});
        task=setTimeout(process,0);
        return;
      }
      setAnalysisSnapshot({rows,source:deferredSource,fields:format.fields,
        locale,archive:archiveDetection,categories:sourceCategories.data,
        selection:sourceSelection,result:{valid,normalized,mediaOnly,invalid,warnings}});
      setAnalysisProgress({completed:index,total:rows.length});
    };
    task=setTimeout(process,0);
    return ()=>{cancelled=true;if(task!==null)clearTimeout(task);};
  },[rows,deferredSource,format.fields,locale,archiveDetection,
    sourceCategories.data,sourceSelection]);
  const analyzed=useMemo(()=>filterImportAnalysisByTime(rawAnalysis,timeWindow),[rawAnalysis,timeWindow]);
  const eligibleArchiveEvidence=useMemo(()=>{
    if(!timeWindow)return archiveEvidence;
    const eligibleUids=new Set(analyzed.valid.map(row=>String(row.uid)));
    return archiveEvidence.filter(item=>item.galaxy_uids?.some(uid=>eligibleUids.has(String(uid))));
  },[archiveEvidence,analyzed.valid,timeWindow]);
  const eligibleArchiveMediaPlan=useMemo(()=>prepareArchiveMedia(
    eligibleArchiveEvidence,
    new Set(analyzed.valid.map(row=>String(row.uid))),
    new Map(analyzed.valid.map(row=>[String(row.uid),row.createtime])),
    new Map(analyzed.valid.map(row=>[String(row.uid),row.title])),
    new Map(analyzed.valid.map(row=>[String(row.uid),row.content]))
  ),[eligibleArchiveEvidence,analyzed.valid]);
  const missingSiteIdCount=useMemo(()=>analyzed.valid.filter(row=>
    ['facebook','threads','instagram'].includes(String(row.site||'').trim().toLowerCase())&&
    !String(row.site_id||'').trim()).length,[analyzed.valid]);
  const unidentifiedUndatedCount=useMemo(()=>analyzed.valid.filter(row=>
    !String(row.site_id||'').trim()&&
    !Number.isFinite(Date.parse(String(row.createtime||'')))).length,[analyzed.valid]);
  const eligibleGeoRecords=useMemo(()=>geoPlaceCandidates.map(place=>({
    ...place,__importPlaceName:place.location,__importPlaceAddress:place.address,
    __importVisitTimes:(place.__importVisitTimes||[]).filter(time=>
      !timeWindow||(time>=timeWindow.start&&time<=timeWindow.end))
  })).filter(place=>place.__importPlaceName&&
    (!timeWindow||place.__importVisitTimes.length>0)),[geoPlaceCandidates,timeWindow]);
  if(!nativeLocal&&!account.canLocAccessSync('scope',scopeId))return null;

  // Refresh the persisted Search snapshot only after a completed import or
  // an explicit manager click. It is never a dependency of importing rows.
  async function refreshImportedSearchSummary(){
    if(nativeLocal||scopeId==='loc'||summaryRefreshing)return false;
    setSummaryRefreshing(true);
    setSummaryError(false);
    setSummaryMessage('');
    try{
      const result=await refreshScopeSearchSummary(scopeId);
      // Search might be cached from an earlier visit; invalidate the
      // persisted snapshot's read cache so the next visit gets new totals.
      await resourceCache.invalidate({queryKey:['scope-search-summary']});
      const nf=new Intl.NumberFormat();
      setSummaryMessage('搜尋文章統計已更新：'+nf.format(result.article_count)+' 篇，'+
        nf.format(result.word_count)+' 字。');
      return true;
    }catch(error){
      setSummaryError(true);
      setSummaryMessage('搜尋文章統計更新失敗：'+String(error?.message||error)+
        '。文章匯入結果不受影響，可按「更新搜尋統計」重試。');
      return false;
    }finally{
      setSummaryRefreshing(false);
    }
  }

  function clearDecodedFile(){
    // Release all large React-owned decoded records and their media/ZIP views.
    // The browser can GC these after any in-flight stack finishes; the
    // original File in queue is still available for an explicit retry.
    setRows([]);
    setArchiveEvidence([]);
    setGeoPlaceCandidates([]);
    setArchiveDetection(null);
    setArchiveSummary(null);
    setProgress(null);
  }
  async function loadQueuedFile(file,index,total,language=importLocale,
    recordPath=format.recordPath,manualChoice=sourceSelection){
    jsonReadAbort.current?.abort();
    const controller=new AbortController();
    jsonReadAbort.current=controller;
    const generation=++fileLoadGeneration.current;
    const isCurrent=()=>generation===fileLoadGeneration.current;
    clearDecodedFile();
    setReparseRequired(false);
    setCheckpointHint(readImportCheckpoint(checkpointStorage(),{
      scopeId,ownerId:importOwnerId,file
    }));
    setFileName(file.name);setStatus('');
    if(file.size>ARCHIVE_MAX_BYTES){
      clearImportCheckpoint(checkpointStorage(),{scopeId,ownerId:importOwnerId,file});
      setCheckpointHint(null);
      // A rejected oversized Blob must not stay pinned in the File queue.
      setQueue(current=>{
        const remaining=current.map((item,position)=>position===index?null:item);
        return remaining.some(Boolean)?remaining:[];
      });
      setStatus(t('uiExtra.importUI.zipTooLarge'));
      return;
    }
    setBusy(true);
    try{
      // Include the first read in the guarded phase; a File.slice error must
      // never leave a silent unhandled rejection or half-selected file.
      const firstBytes=new Uint8Array(await file.slice(0,4).arrayBuffer());
      if(!isCurrent())return;
      const isZip=/\.zip$/i.test(file.name)||(firstBytes[0]===80&&firstBytes[1]===75&&[3,5,7].includes(firstBytes[2]));
      // Explicitly selected source outranks heuristics.
      const selectedFileSource=sourceImportModel(manualChoice)?.label||'';
      const isThreadsJson=!isZip&&selectedFileSource==='Threads'&&/\.json$/i.test(file.name)&&
        /(?:^|[-_. ])(?:threads|text_post_app_text_posts)(?:$|[-_. ])/i.test(file.name);
      const isFacebookGeoJson=!isZip&&selectedFileSource==='Facebook'&&
        /(?:^|\/)places_you_have_been_tagged_in\.json$/i.test(file.name);
      if(isZip)setStatus(t('uiExtra.importUI.zipInspecting'));
      if(isZip||isThreadsJson||isFacebookGeoJson){
        // ZIP, standalone Threads posts and independent Facebook visit JSON use the scanner;
        // source names are only hints, each record must be a public post.
        const {detectZipArchiveSource,inspectPrivateArchive}=await import('../archive/universal.mjs');
        const result=isZip
          ?await detectZipArchiveSource(file,{skipPrivateEntries:!nativeLocal,onProgress:p=>setProgress({stage:'正在辨識 ZIP 檔案',completed:Number(p.filesSeen||0),total:0,percent:null})})
          :{kind:isFacebookGeoJson?'facebook':'threads',
            sources:[isFacebookGeoJson?'facebook':'threads'],confidence:1,
            evidence:[{source:isFacebookGeoJson?'facebook':'threads',path:file.name,verified:false}],
            structure:null,audit:null};
        if(!isCurrent())return;
        setArchiveDetection(result);
        // Mixed ZIPs are classified per entry and each imported record is checked.
        // Inspect every supported source through the shared ZIP scanner.
        // Archive filename/structure picks an adapter; record content is authoritative.
        const imported=[],issuedArticleUids=new Set(),geoPlaces=[],geoKeys=new Map();
        const collector=createArchiveEvidenceCollector();
        const urlAudit={total:0,article:0,media:0,place:0,other:0,truncated:0};
        let ignored=0,privateSkipped=0;
        const summary=await inspectPrivateArchive(file,{skipPrivateEntries:!nativeLocal,
          // ZIP names are indexed without inflating photo/video bytes. Only
          // exact article references + confirmed file presence become media.
          onMediaEntry:entry=>collector.onMediaEntry(entry),
          onGeoPlace:place=>{
          // Separate Facebook visit records remain review candidates, not Galaxy articles.
          const key=String(place.location||'').normalize('NFKC').trim().toLocaleLowerCase('und')+
            '|'+importGeoKey(place.__importCoordinates);
          const time=parseImportCreatedTime(place.timestamp);
          if(geoKeys.has(key)){
            const index=geoKeys.get(key),previous=geoPlaces[index];
            geoPlaces[index]={...previous,
              location:previous.location||place.location,
              address:previous.address||place.address,
              placeUrl:previous.placeUrl||place.placeUrl,
              __importVisitTimes:time?[...(previous.__importVisitTimes||[]),time]:
                previous.__importVisitTimes||[]};
            return;
          }
          if(geoPlaces.length>=100000)
            throw Error('Facebook 不同地點候選超過 100,000 組，未開始匯入；請分批處理。');
          geoKeys.set(key,geoPlaces.length);
          geoPlaces.push({...place,__importVisitTimes:time?[time]:[]});
        },onProgress:p=>setProgress({stage:'正在解析 ZIP 文章與媒體',
          completed:Number(p.filesSeen||0),total:0,percent:null,
          detail:'JSON '+Number(p.jsonFilesParsed||0).toLocaleString()+
            '／'+Number(p.jsonFilesSeen||0).toLocaleString()+
            '；文章 '+Number(p.acceptedRows||0).toLocaleString()
        }),onRecord:record=>{
          if(!nativeLocal&&!isPublicArchiveRecord(record)){
            ignored++;privateSkipped++;return;
          }
          const nestedUrls=auditArchiveUrlAttributes(record.raw);
          for(const key of ['total','article','media','place','other'])
            urlAudit[key]+=nestedUrls[key];
          if(nestedUrls.truncated)urlAudit.truncated++;
          const linked=archiveGalaxyRows(record);
          if(!linked.length){
            collector.onRecord(record,null);ignored++;return;
          }
          // Assign fresh random primary keys per source record. The transient
          // source hashes never become Galaxy UIDs or media relation targets.
          const randomized=remapArchiveArticleUids(
            linked.map(entry=>entry.row),createUid8,issuedArticleUids);
          for(const [index,entry] of linked.entries()){
            const article=randomized[index];
            collector.onRecord({...record,attachments:entry.attachments},article.uid);
            if(imported.length>=100000)
              throw Error('備份文字紀錄超過本次 100,000 筆安全上限，未匯入。');
            imported.push({raw:article,import_uid:article.uid});
          }
        }});
        if(!isCurrent())return;
        const mediaEvidence=collector.rows({scopeId,archiveName:file.name,archiveSize:file.size})
          .filter(item=>nativeLocal||item.referenced_by_post||(imported.length>0&&item.galaxy_uids?.some(uid=>issuedArticleUids.has(uid))));
        const previewArticleTimes=new Map(imported.map(item=>[String(item.raw.uid),item.raw.createtime]));
        const previewArticleTitles=new Map(imported.map(item=>[String(item.raw.uid),item.raw.title]));
        const previewArticleContents=new Map(imported.map(item=>[String(item.raw.uid),item.raw.content]));
        const mediaPlan=prepareArchiveMedia(
          mediaEvidence,issuedArticleUids,previewArticleTimes,
          previewArticleTitles,previewArticleContents);
        setArchiveEvidence(mediaEvidence);
        setGeoPlaceCandidates(geoPlaces);
        setArchiveSummary({...summary,urlAudit,
          articleWithUrl:imported.filter(item=>Boolean(item.raw?.url)).length,
          mediaEvidenceCount:mediaEvidence.length,
          mediaImportable:mediaPlan.media.length,
          mediaWithUrl:mediaPlan.media.filter(item=>Boolean(item.url)).length,
          mediaZipLinked:mediaPlan.media.filter(item=>!item.url).length,
          mediaZipNotLinked:Math.max(0,summary.mediaFiles-
            mediaEvidence.filter(item=>item.found_in_zip&&item.galaxy_uids?.length).length),
          mediaLinked:mediaEvidence.filter(item=>item.galaxy_uids?.length).length,
          mediaUnlinked:mediaPlan.media.filter(item=>!item.__article_uid).length});
        if(!imported.length&&!mediaEvidence.length){
          if(!manualChoice)setSource(result.sources.length===1?canonicalSource(result.sources[0]):'');
          setStatus((summary.geoPlaceObjects?'檔案已讀取，辨識出 '+summary.geoPlaceObjects.toLocaleString()+' 筆 Facebook 地點物件，僅供人工整理 Trace；沒有自動建立地點或文章。':'檔案已讀取，但沒有可匯入的文字文章。')+' 已解析 '+summary.totalRows+
            ' 筆、略過 '+(summary.rejectedRows+ignored)+' 筆。'+
            (summary.problems.length?' 原因：'+summary.problems.slice(0,3).join('；'):' 請檢查資料格式。'));
          return;
        }
        setRows(imported);
        const sourceNames=[...new Set(imported.map(item=>item.raw.site))];
        if(sourceNames.length!==1)setSource('Mixed');
        else if(!manualChoice)setSource(canonicalSource(sourceNames[0]));
        setStatus('已解析共 '+imported.length.toLocaleString()+' 篇公開貼文，其中有 '+
          imported.filter(item=>Boolean(item.raw?.url)).length.toLocaleString()+
          ' 篇含原始貼文連結網址；ZIP 內，共有媒體檔總數 '+summary.mediaFiles.toLocaleString()+
          ' 個、已找到文章關聯的可建檔媒體共 '+mediaPlan.media.length.toLocaleString()+
          ' 筆（設定為可公開讀取共 '+mediaPlan.media.filter(item=>item.url).length.toLocaleString()+
          ' 筆、其餘未公開媒體，僅存於 ZIP 附件，共 '+mediaPlan.media.filter(item=>!item.url).length.toLocaleString()+
          ' 筆）；因故略過 '+
          (ignored+summary.rejectedRows).toLocaleString()+
          ' 筆（安全問題、空文章、已刪除內容等）。請核對預覽後，在「作品儲存資料庫」按開始匯入。');
        return;
      }
      const options={recordPath,importLocale:language,
        source:manualChoice==='__custom__'?'':manualChoice};
      const parseAsJson=/\.json$/i.test(file.name);
      if(parseAsJson)setParsingJson(true);
      let parsed;
      try{
        parsed=parseAsJson
          ?await import('./json-worker-client.mjs').then(({parseJsonImportOffMainThread})=>
            parseJsonImportOffMainThread(file,options,{
              signal:controller.signal,
              onProgress:stage=>{if(isCurrent())setProgress({stage,completed:0,total:0});}
            }))
          :await import('./universal-file.mjs').then(({parseUniversalImportFile})=>
            parseUniversalImportFile(file,options));
      }finally{
        if(isCurrent())setParsingJson(false);
      }
      if(!isCurrent())return;
      const list=filterStandalonePublicRows(parsed,nativeLocal);
      assertStandaloneImportDestination({nativeLocal,fileName:file.name,rows:list});
      const prepared=list.map(row=>({
        raw:row,
        import_uid:createUid8()
      }));
      setRows(prepared);
      // Detection is a suggestion; do not silently overwrite manual selection.
      if(!manualChoice)setSource('');
      setStatus(t('uiExtra.importUI.parsedFile',{index:index+1,total,count:list.length.toLocaleString()})+
        (parsed.length!==list.length?'；已略過 '+(parsed.length-list.length).toLocaleString()+' 筆私人紀錄。':''));
    }catch(error){
      if(!isCurrent())return;
      clearDecodedFile();
      setReparseRequired(true);
      const wasBlocked=['LOC_PRIVATE_ARCHIVE_BLOCKED','LOC_UNVERIFIED_ARCHIVE_BLOCKED'].includes(error?.code);
      if(wasBlocked){
        // Privacy-rejected archives are not retryable on a public Scope.
        clearImportCheckpoint(checkpointStorage(),{scopeId,ownerId:importOwnerId,file});
        setCheckpointHint(null);
        setReparseRequired(false);
        setQueue(current=>{
          const remaining=current.map((item,position)=>position===index?null:item);
          return remaining.some(Boolean)?remaining:[];
        });
      }
      setStatus(wasBlocked
        ?'第 '+(index+1)+' 檔已阻止匯入：'+String(error?.message||error)+'；本次未寫入資料庫。'
        :t('uiExtra.importUI.parseFileFailed',{index:index+1,error:error?.message||error}));
    }finally{
      if(isCurrent()){
        jsonReadAbort.current=null;
        setParsingJson(false);
        setBusy(false);setProgress(null);
      }
    }
  }
  function cancelJsonParse(){
    if(!parsingJson||!jsonReadAbort.current)return;
    jsonReadAbort.current.abort();
  }
  async function chooseFile(event){
    if(busy)return;
    const files=Array.from(event.target.files||[]);
    // The browser input is another owner of selected File/ZIP bytes. Drop its
    // reference once the queue has captured them, so choosing the same file
    // later also works without retaining the old FileList.
    event.target.value='';
    if(!files.length)return;
    if(!sourceSelection){
      setStatus('請先選擇匯入來源模型，再選擇檔案。');
      return;
    }
    setQueue(files);setQueueIndex(0);
    await loadQueuedFile(files[0],0,files.length);
  }
  function releaseCompletedFile(){
    // A successful write is the disposal boundary. Retain only *upcoming*
    // files in a multi-file queue; failures intentionally retain their input
    // for retry, and persisted database rows are never touched.
    clearImportCheckpoint(checkpointStorage(),{
      scopeId,ownerId:importOwnerId,file:queue[queueIndex]
    });
    setCheckpointHint(null);
    clearDecodedFile();
    setReparseRequired(false);
    setQueue(current=>{
      const pendingFiles=current.map((file,index)=>index<=queueIndex?null:file);
      return pendingFiles.some(Boolean)?pendingFiles:[];
    });
  }
  async function retryFailedFile(){
    const file=queue[queueIndex];
    if(busy||!reparseRequired||!file)return;
    const selectedSource=source;
    // Reparse from the original File, then repeat the normal full UID/site
    // comparison before any new writes. No blind replay of partially
    // committed SQL batches, and no hidden automatic retries.
    await loadQueuedFile(file,queueIndex,queue.length,importLocale,format.recordPath);
    if(selectedSource)setSource(selectedSource);
  }
  function discardFailedFile(){
    if(busy||!reparseRequired)return;
    clearImportCheckpoint(checkpointStorage(),{
      scopeId,ownerId:importOwnerId,file:queue[queueIndex]
    });
    setCheckpointHint(null);
    clearDecodedFile();
    setReparseRequired(false);
    setFileName('');
    setSource('');
    setSourceSelection('');
    setQueue(current=>{
      const remaining=current.map((file,index)=>index===queueIndex?null:file);
      return remaining.some(Boolean)?remaining:[];
    });
    setStatus('已釋放本次檔案與解析資料；先前已確認寫入的資料庫紀錄不受影響。');
  }
  async function nextFile(){
    const next=queueIndex+1;
    if(busy||next>=queue.length)return;
    // Each queued file requires its own deliberate source-model choice.
    setSourceSelection('');
    setSource('');
    setQueueIndex(next);
    setFileName(queue[next].name);
    clearDecodedFile();
    setStatus('請為下一個檔案選擇匯入來源，再進行解析。');
  }
  const canRestoreAnchors=scopeId!=='local'&&scopeId!=='loc'&&(
    eligibleGeoRecords.length>0||
    analyzed.valid.some(record=>Boolean(record.location||record.__importPlaceName))
  );
  async function saveGeoPlaces(){
    if(busy||!canRestoreAnchors||rows.length||archiveEvidence.length)return;
    const candidates=eligibleGeoRecords;
    if(!candidates.length)return;
    if(!window.confirm('將原始打卡地名及日期匯入空間與時間定錨（已存在的沿用；不新增文章）。確定執行？'))return;
    setBusy(true);setStatus('');setProgress({stage:'核對原始打卡地點',completed:0,total:0,percent:null});
    try{
      const anchorSnapshot=await readImportPointDateAnchors({
        scopeId,
        onProgress:p=>setProgress({stage:p.phase,completed:p.completed,total:0,percent:null})
      });
      const result=await prepareImportPlaceAnchors(candidates,{
        scopeId,relation:dbAuthRelation,createMissing:true,anchorSnapshot,
        onProgress:p=>setProgress({stage:p.phase,completed:p.completed,total:p.total||0,
          percent:p.total?Math.round(100*p.completed/p.total):null})
      });
      const dates=await prepareImportTimeAnchors(candidates,{
        scopeId,timeTable:account.scopeDataFor(scopeId)?.time,relation:dbAuthRelation,
        anchorSnapshot,includeUnifiedUidPool:true,
        onProgress:p=>setProgress({stage:p.phase,completed:p.completed,total:p.total||0,
          percent:p.total?Math.round(100*p.completed/p.total):null})
      });
      setStatus('獨立 Facebook 打卡已匯入：空間定錨新增 '+result.created.toLocaleString()+
        '、沿用 '+result.reused.toLocaleString()+'；日期定錨新增 '+
        dates.created.toLocaleString()+'、沿用 '+dates.reused.toLocaleString()+
        '。沒有新增 Galaxy 文章；缺少原始座標的地點不會捏造座標。'+
        importAnchorConflictSummary(result,dates));
    }catch(error){setStatus('Trace 地點儲存失敗：'+String(error?.message||error));}
    finally{setBusy(false);setProgress(null);}
  }
  async function restoreExistingAnchors(){
    if(busy||nativeLocal||scopeId==='loc')return;
    if(!window.confirm('補齊既有文章的空間定錨、日期定錨與地點關聯；不新增或刪除文章、不覆寫原始建立時間。確定執行？'))return;
    setBusy(true);setStatus('');
    const show=p=>{
      try{touchEditorSession(window.sessionStorage);}catch{}
      setProgress({stage:p.phase,completed:p.completed,total:p.total||0,
        percent:p.total?Math.round(100*p.completed/p.total):null});
    };
    try{
      const scope=account.scopeDataFor(scopeId);
      if(!scope?.galaxy||!scope?.time)throw Error('資料範圍尚未載入');
      const result=await reconcileExistingImportAnchors({
        scopeId,galaxy:scope.galaxy,timeTable:scope.time,relation:dbAuthRelation,
        updateImportRows,onProgress:show
      });
      setStatus('既有地點文章核對 '+result.scanned.toLocaleString()+' 筆；空間定錨新增 '+
        result.places.created.toLocaleString()+'、沿用 '+result.places.reused.toLocaleString()+
        '；日期定錨新增 '+result.dates.created.toLocaleString()+'、沿用 '+
        result.dates.reused.toLocaleString()+'；文章地點關聯補齊 '+
        result.linked.toLocaleString()+'，未能確定地點 '+result.unmatched.toLocaleString()+' 筆。'+
        importAnchorConflictSummary(result.places,result.dates));
    }catch(error){
      setStatus('既有打卡定錨修復失敗；已完成的部分可能已寫入，重新執行會沿用既有資料。原始錯誤：'+String(error?.message||error));
    }finally{setProgress(null);setBusy(false);}
  }
  async function run(){
    if(busy||!analysisCurrent)return;
    if(!archiveDetection&&!sourceSelection){
      setStatus('請先選擇匯入來源模型，再確認預覽。');return;
    }
    const selected=canonicalSource(source);
    if(!selected){setStatus(t('uiExtra.importUI.selectSource'));return;}
    if(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveEvidence.length){
      setStatus('沒有可寫入的有效文章或媒體；請核對來源、時間範圍及略過原因。');return;
    }
    try{
      if(archiveDetection){
        // The public-row guard, not the archive filename, controls publishing.
        if(!nativeLocal&&rows.some(item=>!['facebook','threads','instagram','x'].includes(String(item.raw?.site||'').toLowerCase())))
          throw new Error('公開網站的 ZIP 不允許匯入私人對話或無法辨識的紀錄。');
      }else assertStandaloneImportDestination({nativeLocal,fileName,rows,source});
    }
    catch(error){setStatus(String(error?.message||error));return;}
    // Original check-in names and calendar dates are part of the import, not an optional follow-up.
    setBusy(true);setStatus('');
    let lastImportStage='準備匯入文章';
    const showProgress=(stage,completed=0,total=0)=>{
      lastImportStage=stage;
      // A long read-only comparison phase never calls the database write path,
      // so without this the edit Session's idle timer can expire mid-import
      // even though the browser is actively working the whole time.
      if(!nativeLocal)try{touchEditorSession(window.sessionStorage);}catch{}
      setProgress(previous=>({
        stage,completed,total,
        stageStartedAt:previous?.stage===stage&&previous.stageStartedAt
          ?previous.stageStartedAt:Date.now(),
        percent:total>0?Math.round(100*completed/total):null
      }));
    };
    showProgress('準備匯入文章');
    try{
      // Load ZenStack/Zod only on an actual JSON write request, not on page
      // navigation or every source-selector repaint. The imported raw JSON
      // stays untouched; the existing Galaxy write model validates it later.
      if(!archiveDetection&&/\.json$/i.test(fileName)){
        const [{assertZModelSourceImportRecord},{assertSourceImportRowsInSlices}]=
          await Promise.all([
            import('../../../packages/zenstack/import-validation.mjs'),
            import('./source-validation-slices.mjs')
          ]);
        await assertSourceImportRowsInSlices(rows,selected,assertZModelSourceImportRecord,{
          onProgress:({completed,total})=>
            showProgress('來源 ZModel 驗證',completed,total)
        });
      }
      const scope=nativeLocal?defaultScopeData('local'):account.scopeDataFor(scopeId);
      const galaxy=scope?.galaxy,mediaAnchor=scope?.anchor;
      if(!galaxy||!mediaAnchor)throw new Error(t('uiExtra.importUI.scopeUnresolved'));
      // First narrow all database comparisons to the source site, then timestamp.
      // Check each site's existing data ONCE before creating a comparison pool.
      // If site is empty, the complete file stays in INSERT mode regardless
      // of how many previous batches have already been written.
      const siteAvailability=new Map();
      const siteHasArticles=async site=>{
        if(!siteAvailability.has(site)){
          const {data,error}=await dbAuthRelation(galaxy).select('uid').ieq('site',site).limit(1);
          if(error)throw Error('網站範圍查詢失敗：'+error.message);
          siteAvailability.set(site,Boolean(data?.length));
        }
        return siteAvailability.get(site);
      };
      const distinctSites=[...new Set(analyzed.valid.map(row=>String(row.site||'').trim()))];
      // Import source presence is a business-data question on Galaxy.site,
      // not a SiteAnchor title JOIN. Batch bounded exact site keys through
      // the authenticated existing Kysely action instead of issuing one
      // browser-to-SQL request for each platform in a mixed-source ZIP.
      if(!nativeLocal&&scopeId!=='loc'){
        const sites=distinctSites.filter(site=>site.length<=512);
        for(let offset=0;offset<sites.length;offset+=200){
          const chunk=sites.slice(offset,offset+200);
          const requested=new Set(chunk.map(site=>site.toLowerCase()));
          const {data,error}=await dbAuthClient.schema('silver').managedAction(
            'import_site_presence',{p_scope_id:scopeId,p_sites:chunk});
          if(error)throw Error('來源集合查詢失敗：'+(error.message||error));
          if(!Array.isArray(data)||data.length>requested.size||
              data.some(key=>typeof key!=='string'||!requested.has(key))||
              new Set(data).size!==data.length)
            throw Error('來源集合查詢回傳格式或 Scope 不符');
          const found=new Set(data);
          for(const site of chunk)siteAvailability.set(site,found.has(site.toLowerCase()));
          showProgress('確認網站既有文章',Math.min(offset+chunk.length,sites.length),distinctSites.length);
        }
      }
      // Local files / unusual legacy site strings retain their existing
      // adapter path, without changing the independently stored Scope model.
      for(let index=0;index<distinctSites.length;index++){
        await siteHasArticles(distinctSites[index]);
        showProgress('確認網站既有文章',index+1,distinctSites.length);
      }
      // Deduplicate the entire imported file, not only sites populated
      // before this import. Preserve the canonical UID for media references.
      const incoming=dedupeIncomingImport(analyzed.valid);
      let unique=incoming.unique;
      let duplicateCount=incoming.duplicates;
      const readRowsByUid=async uids=>{
        const rows=[];
        for(const batch of urlSafeInBatches(uids,'uid')){
          const {data,error}=await dbAuthRelation(galaxy)
            .select(GALAXY_IMPORT_UID_COLUMNS)
            .in('uid',batch);
          if(error)throw Error('uid 比對失敗：'+error.message);
          for(const row of data||[])rows.push(row);
        }
        return rows;
      };
      // The genuine platform post ID is authoritative; look it up before
      // timestamp comparison so edits in export time cannot create duplicates.
      const existingCandidates=unique.filter(row=>
        siteAvailability.get(String(row.site||'').trim()));
      const matchesById=existingCandidates.length?await matchExistingImportBySiteId(existingCandidates,{
        onProgress:p=>showProgress('依來源文章 ID 比對',p.completed,p.total),
        readSiteIds:async(ids,consumePage,site)=>{
          if(!nativeLocal&&scopeId!=='loc'){
            await readImportIdentityCandidates({scopeId,site,
              action:'import_site_id_candidates',keys:ids,onPage:consumePage});
            return;
          }
          for(const idsPage of urlSafeInBatches(ids,'site_id')){
            // Page every stored candidate; one platform ID can map to
            // multiple legacy rows and must remain ambiguous until compared.
            const pageSize=MAX_ROWS;
            for(let offset=0;;){
              const {data,error}=await dbAuthRelation(galaxy)
                .select(GALAXY_IMPORT_UID_COLUMNS)
                .ieq('site',site).in('site_id',idsPage)
                .order('uid',{ascending:true})
                .range(offset,offset+pageSize-1);
              if(error)throw Error('site_id 比對失敗：'+error.message);
              const page=data||[];
              if(!Array.isArray(page))throw Error('site_id 比對回傳格式錯誤');
              if(!page.length)break;
              consumePage(page);
              offset+=page.length;
              if(page.length<pageSize)break;
            }
          }
        }
      }):new Map();
      const ambiguousById=matchesById.ambiguous||[];
      const ambiguousByIdUids=new Set(ambiguousById.map(row=>row.uid));
      // A verified native source ID or an existing Galaxy primary key wins
      // before any evidence fallback; equal timestamps alone prove nothing.
      const remaining=existingCandidates.filter(record=>
        !matchesById.has(String(record.uid))&&!ambiguousByIdUids.has(String(record.uid)));
      const byPrimaryUid=new Map();
      const incomingByPrimaryUid=new Map(remaining.map(row=>[String(row.uid),row]));
      for(const batch of urlSafeInBatches([...incomingByPrimaryUid.keys()],'uid')){
        const saved=await readRowsByUid(batch);
        for(const stored of saved){
          const incoming=incomingByPrimaryUid.get(String(stored.uid));
          if(!incoming)throw Error('UID 比對回傳不屬於本次匯入的文章');
          if(String(stored.site||'').trim().toLowerCase()!==
              String(incoming.site||'').trim().toLowerCase()||
              stored.site_id&&incoming.site_id&&
                String(stored.site_id)!==String(incoming.site_id))
            throw Error('UID 主鍵已屬於其他來源文章：'+stored.uid);
          byPrimaryUid.set(String(incoming.uid),stored);
        }
      }
      const unresolved=remaining.filter(row=>
        !byPrimaryUid.has(String(row.uid))&&!String(row.site_id||'').trim());
      // Original source creation time is the identity key; locally generated
      // Galaxy UIDs and article content are never used for this comparison.
      // Rows using UpdateTime fallback skip this matcher.
      const matchesByTime=unresolved.length?
        await matchExistingImportByCreatedAt(unresolved,{
          excludeSavedUids:new Set([
            ...matchesById.values(),...byPrimaryUid.values()
          ].map(row=>String(row.uid))),
          onProgress:p=>showProgress('依來源與建立時間比對',p.completed,p.total),
          readSourceRows:async({site,fromDate,toDate,instants=[],consumePage})=>{
            if(!nativeLocal&&scopeId!=='loc'){
              await readImportIdentityCandidates({scopeId,site,
                action:'import_created_at_candidates',
                keys:instants,onPage:consumePage});
              return;
            }
            const pageSize=MAX_ROWS;
            const dated=async()=>{
              let afterDate=null,afterUid=null;
              for(;;){
                let query=dbAuthRelation(galaxy)
                  .select('uid,site,site_id,createtime,date')
                  .ieq('site',site).gte('date',fromDate).lte('date',toDate)
                  .order('date',{ascending:true}).order('uid',{ascending:true})
                  .limit(pageSize);
                if(afterDate!==null)
                  query=query.or('date.gt.'+afterDate+
                    ',and(date.eq.'+afterDate+',uid.gt.'+afterUid+')');
                const {data,error}=await query;
                if(error)throw Error('來源時間查詢失敗：'+error.message);
                const page=data||[];
                if(!Array.isArray(page)||page.length>pageSize)
                  throw Error('來源時間查詢回傳格式錯誤');
                if(!page.length)break;
                consumePage(page);
                const last=page.at(-1);
                const date=String(last?.date||''),uid=String(last?.uid||'');
                if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
                  !/^[A-Za-z0-9]{8}$/.test(uid)||
                  afterDate!==null&&(date<afterDate||
                    date===afterDate&&uid<=afterUid))
                  throw Error('來源時間日期游標未前進，停止匯入');
                afterDate=date;afterUid=uid;
                if(page.length<pageSize)break;
              }
            };
            const undated=async()=>{
              let afterUid=null;
              for(;;){
                let query=dbAuthRelation(galaxy)
                  .select('uid,site,site_id,createtime,date')
                  .ieq('site',site).is('date',null)
                  .order('uid',{ascending:true}).limit(pageSize);
                if(afterUid!==null)query=query.gt('uid',afterUid);
                const {data,error}=await query;
                if(error)throw Error('無日期文章來源時間查詢失敗：'+error.message);
                const page=data||[];
                if(!Array.isArray(page)||page.length>pageSize)
                  throw Error('無日期文章來源時間查詢回傳格式錯誤');
                if(!page.length)break;
                consumePage(page);
                const uid=String(page.at(-1)?.uid||'');
                if(!/^[A-Za-z0-9]{8}$/.test(uid)||
                  afterUid!==null&&uid<=afterUid)
                  throw Error('無日期文章 UID 游標未前進');
                afterUid=uid;
                if(page.length<pageSize)break;
              }
            };
            await dated();
            await undated();
          }
        }):new Map();
      const existingBySiteId=new Map([
        ...matchesByTime,...byPrimaryUid,...matchesById
      ]);
      const ambiguousGroups=[
        ...ambiguousById,...(matchesByTime.ambiguous||[])
      ];
      if(ambiguousGroups.length){
        const ambiguousUids=new Set(ambiguousGroups.map(group=>group.uid));
        unique=unique.filter(record=>!ambiguousUids.has(String(record.uid)));
      }

      // Final Galaxy INSERT preparation: honor original creation timestamps
      // for matching first, then allocate non-colliding timestamptz(6) values
      // only for new articles. This does not modify an existing post's date.
      const incomingNew=unique.filter(record=>!existingBySiteId.has(String(record.uid)));
      if(incomingNew.length){
        const fallbackTime=new Date().toISOString();
        const targetDays=[...new Set(incomingNew.map(row=>
          importCalendarDay(row.createtime||fallbackTime)))].filter(Boolean).sort();
        const occupiedTimes=[];
        const pageSize=MAX_ROWS;
        const appendOccupied=page=>{
          if(!Array.isArray(page)||page.length>pageSize)
            throw Error('匯入時間查詢回傳格式錯誤');
          for(const row of page)
            if(row?.createtime)occupiedTimes.push(row.createtime);
        };
        // Group the requested calendar dates into bounded IN-index probes.
        // Scanning thousands of individual days requires thousands of HTTP
        // round trips; PostgreSQL can use its existing date index for each
        // small IN set, while the date+UID cursor handles dense days.
        for(let offset=0;offset<targetDays.length;offset+=40){
          const days=targetDays.slice(offset,offset+40);
          let afterDate=null,afterUid=null;
          for(;;){
            let query=dbAuthRelation(galaxy)
              .select('uid,createtime,date')
              .in('date',days)
              .order('date',{ascending:true}).order('uid',{ascending:true})
              .limit(pageSize);
            if(afterDate!==null)
              query=query.gte('date',afterDate).or(
                'date.gt.'+afterDate+
                ',and(date.eq.'+afterDate+',uid.gt.'+afterUid+')');
            const {data,error}=await query;
            if(error)throw Error('匯入時間索引查詢失敗：'+error.message);
            const page=data||[];
            appendOccupied(page);
            if(page.length<pageSize)break;
            const last=page.at(-1);
            const date=String(last?.date||''),uid=String(last?.uid||'');
            if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
              !/^[A-Za-z0-9]{8}$/.test(uid)||
              afterDate!==null&&(date<afterDate||
                date===afterDate&&uid<=afterUid))
              throw Error('匯入日期／UID 游標未前進');
            afterDate=date;afterUid=uid;
          }
        }
        // Legacy Galaxy rows can still carry createtime with a NULL date.
        // Read this subset once instead of scanning it again for each day.
        let afterUndatedUid=null;
        for(;;){
          let query=dbAuthRelation(galaxy).select('uid,createtime')
            .is('date',null).order('uid',{ascending:true})
            .limit(pageSize);
          if(afterUndatedUid!==null)
            query=query.gt('uid',afterUndatedUid);
          const {data,error}=await query;
          if(error)throw Error('匯入無日期時間查詢失敗：'+error.message);
          const page=data||[];
          appendOccupied(page);
          if(page.length<pageSize)break;
          const uid=String(page.at(-1)?.uid||'');
          if(!/^[A-Za-z0-9]{8}$/.test(uid)||
            afterUndatedUid!==null&&uid<=afterUndatedUid)
            throw Error('無日期時間 UID 游標未前進');
          afterUndatedUid=uid;
        }
        const finalized=finalizeImportCreatedTimes(incomingNew,{
          occupiedTimes,fallbackTime
        });
        const finalByUid=new Map(finalized.map(row=>[String(row.uid),row]));
        unique=unique.map(row=>finalByUid.get(String(row.uid))||row);
      }

      // Only imported article UIDs and verified persisted PKs participate.
      // Immer emits narrow patches for source_id / target_id / ref_id before
      // either UPDATE or INSERT; unrelated rows and article content are untouched.
      unique=remapImportUidRelations(unique,{
        aliases:incoming.aliases,existingByUid:existingBySiteId
      }).rows;
      const resolvedUid=createImportUidResolver(incoming.aliases,existingBySiteId);
      const persistedUids=new Set([...existingBySiteId.values()].map(row=>String(row.uid)));
      // Before changing any stored nonempty UID, ask PostgreSQL only whether
      // that exact eight-character PK still exists. An existing PK always
      // wins over a coincidental incoming archive UID alias. No Galaxy body,
      // Anchor model, title, location, site or semantic comparison is loaded.
      const possiblyRebound=new Set();
      const collectStoredUid=value=>{
        if(typeof value!=='string'||!/^[A-Za-z0-9]{8}$/.test(value))return;
        if(resolvedUid(value)!==value)possiblyRebound.add(value);
      };
      for(const saved of existingBySiteId.values()){
        collectStoredUid(saved.source_id);
        collectStoredUid(saved.ref_id);
        for(const target of saved.target_id||[])collectStoredUid(target);
      }
      const occupiedUids=new Set();
      for(const batch of urlSafeInBatches([...possiblyRebound],'uid')){
        const {data,error}=await dbAuthRelation(galaxy).select('uid').in('uid',batch);
        if(error)throw Error('既有 UID 主鍵核對失敗：'+(error.message||error));
        const requested=new Set(batch);
        for(const row of data||[]){
          const uid=String(row?.uid||'');
          if(!requested.has(uid))throw Error('UID 主鍵核對回傳不屬於本次 Scope');
          occupiedUids.add(uid);
        }
      }
      // Only a missing/stale saved UID may follow a proven import alias to a
      // confirmed saved article. Pending INSERT UIDs cannot replace old links.
      const resolveSavedUid=value=>{
        if(occupiedUids.has(value))return value;
        const mapped=resolvedUid(value);
        return persistedUids.has(mapped)?mapped:value;
      };
      // Build exact PK-link changes ONCE before any UPDATE, then reuse the
      // same Immer change set when writing. Content-only no-op logic must not
      // silently suppress a required dangling-UID repair on reimport.
      const uidUpdatesByImportUid=new Map();
      for(const record of unique){
        const saved=existingBySiteId.get(record.uid);
        if(!saved)continue;
        const {changes}=planExistingImportUidUpdate(saved,record,{resolveSavedUid});
        if(Object.keys(changes).length)uidUpdatesByImportUid.set(record.uid,changes);
      }
      // Articles with check-ins still need a spatial/date backfill on repeat imports.
      if(!uidUpdatesByImportUid.size&&isUnchangedImportBeforeWrite(unique,existingBySiteId,{
        hasMedia:Boolean(analyzed.mediaOnly.length||eligibleArchiveEvidence.length||
          eligibleGeoRecords.length||
          analyzed.normalized.some(item=>(item.mediaRecords?.length||0)||
            (item.mediaRefs?.length||0)))
      })&&!unique.some(record=>record.location||record.__importPlaceName||
        existingBySiteId.get(record.uid)?.location)){
        // A no-change reimport may follow an older partial success whose
        // Search snapshot is still stale. Refresh it once even for a no-op.
        if(!nativeLocal)await refreshImportedSearchSummary();
        setProgress(null);
        setStatus(t('uiExtra.importUI.importNoChanges'));
        releaseCompletedFile();
        return;
      }
      // Importing an original check-in also restores its spatial anchor.
      // The Timeline importer remains supplemental and does not run here.
      showProgress('準備空間定錨');
      const geoAnchorRecords=eligibleGeoRecords;
      // Reimports must also repair the existing row's location and exact
      // Galaxy.date, even when the incoming duplicate has no place metadata.
      const anchorRecords=unique.map(record=>{
        const saved=existingBySiteId.get(record.uid);
        return {...record,
          location:record.location||saved?.location||null,
          date:saved?.date||record.date||null
        };
      });
      const placeRecordByUid=new Map(anchorRecords.map(row=>[String(row.uid),row]));
      // A previously linked Point is still a valid UID visit even when its
      // original Galaxy.location is blank. Date titles still require an
      // actual place label in importCheckinDayEntries, as before.
      const checkinAnchorRecords=anchorRecords.filter(record=>
        Boolean(record.location||record.__importPlaceName||
          existingBySiteId.get(record.uid)?.place_id));
      // UID wins over location text: an existing place_id must not trigger
      // a name/coordinate re-scan of every Point in the Scope. Resolve saved
      // PKs directly while reading Date rows only when no new place is needed.
      const newPlaceCandidates=anchorRecords.filter(record=>
        !String(existingBySiteId.get(record.uid)?.place_id||'')&&
        Boolean(record.location||record.__importPlaceName));
      const needsPointDiscovery=Boolean(newPlaceCandidates.length||geoAnchorRecords.length);
      const savedPointUids=[...new Set(unique.map(row=>
        existingBySiteId.get(row.uid)?.place_id).filter(uid=>
          typeof uid==='string'&&/^[A-Za-z0-9]{8}$/.test(uid)))];
      const anchorSnapshot=!nativeLocal&&scopeId!=='loc'&&
        (checkinAnchorRecords.length||geoAnchorRecords.length)
        ?await readImportPointDateAnchors({scopeId,
          ...(needsPointDiscovery?{}:{pointUids:savedPointUids}),
          onProgress:p=>showProgress(p.phase,p.completed,p.total||0)})
        :null;
      const placeAnchors=await prepareImportPlaceAnchors([...newPlaceCandidates,...geoAnchorRecords],{
        scopeId,relation:dbAuthRelation,createMissing:true,anchorSnapshot,
        onProgress:p=>showProgress(p.phase,p.completed,p.total||0)
      });
      const timeAnchors=await prepareImportTimeAnchors([...checkinAnchorRecords,...geoAnchorRecords],{
        scopeId,timeTable:scope?.time,relation:dbAuthRelation,
        anchorSnapshot,includeUnifiedUidPool:true,
        onProgress:p=>showProgress(p.phase,p.completed,p.total||0)
      });
      const knownArticleIds=new Map();
      let updated=0,checkedExisting=0;
      const missingPointUids=new Set();
      const updateSizer=createImportBatchSizer();
      const checkpointBatch=(phase,confirmed,total,inserted=0,conflicts=0)=>{
        const receipt=writeImportCheckpoint(checkpointStorage(),{
          scopeId,ownerId:importOwnerId,file:queue[queueIndex],
          phase,confirmed,total,inserted,conflicts
        });
        if(receipt)setCheckpointHint(receipt);
      };
      let updateQueue=[],updateBytes=0;
      const existingCount=existingBySiteId.size;
      if(existingCount)showProgress('更新既有文章',0,existingCount);
      const flushUpdates=async()=>{
        if(!updateQueue.length)return;
        const count=updateQueue.length,started=Date.now();
        const characters=updateQueue.reduce((sum,row)=>sum+JSON.stringify(row).length,0);
        const result=await updateImportRows(galaxy,updateQueue);
        updated+=result.count;
        updateQueue=[];updateBytes=0;
        updateSizer.observe(count,Date.now()-started,characters);
        // A receipt's confirmed count is rows examined, not only rows
        // changed. Most reimports update very few columns.
        checkpointBatch('update',checkedExisting,existingCount,updated);
      };
      for(const record of unique){
        const existing=existingBySiteId.get(record.uid);
        if(!existing)continue;
        knownArticleIds.set(record.uid,String(existing.uid));
        const changes={};
        if(String(existing.title||'')!==String(record.title||''))changes.title=record.title;
        if(String(existing.content||'')!==String(record.content||''))changes.content=record.content;
        // Enrich missing source metadata; preserve curated existing values.
        if(!String(existing.location||'').trim()&&String(record.location||'').trim())changes.location=record.location;
        if(!String(existing.site_id||'').trim()&&String(record.site_id||'').trim())changes.site_id=record.site_id;
        if(!String(existing.url||'').trim()&&String(record.url||'').trim())changes.url=record.url;
        const placeRecord=placeRecordByUid.get(String(record.uid))||record;
        const restoredPlace=importedPlaceId({incoming:placeRecord,existing,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
        // Immer compares only 8-char UID references. Emit exactly the PK
        // fields changed by this row, then pass them to existing Kysely writer.
        Object.assign(changes,uidUpdatesByImportUid.get(record.uid)||{},
          planImportPointUidLink(existing.place_id,restoredPlace).changes);
        // Confirm an existing PK directly in the shared Point UID index.
        // Distinct literal locations with the same place_id remain one Point;
        // no title/name/coordinate lookup is necessary for a saved link.
        const storedPointUid=String(existing.place_id||'');
        const savedPointExists=storedPointUid&&
          anchorSnapshot?.place?.knownPointUids.has(storedPointUid);
        if(storedPointUid&&anchorSnapshot&&!savedPointExists)
          missingPointUids.add(storedPointUid);
        if(Object.keys(changes).length){
          const update={uid:String(existing.uid),...changes};
          const bytes=updateSizer.byteSize(update);
          if(updateSizer.shouldFlush(updateQueue.length,updateBytes,bytes))
            await flushUpdates();
          updateQueue.push(update);updateBytes+=bytes;
          if(updateSizer.shouldFlush(updateQueue.length,updateBytes))
            await flushUpdates();
        }
        checkedExisting++;
        if(checkedExisting%25===0||checkedExisting===existingCount)
          showProgress('更新既有文章',checkedExisting,existingCount);
      }
      await flushUpdates();
      const newArticleTotal=unique.length-existingBySiteId.size;
      if(newArticleTotal)showProgress('新增文章',0,newArticleTotal);
      const result={inserted:0,conflicts:0,insertedUids:new Set(),conflictedUids:new Set()};
      const insertSizer=createImportBatchSizer();
      let payload=[],payloadBytes=0,newArticleProcessed=0;
      const flushNewArticles=async()=>{
        if(!payload.length)return;
        const count=payload.length,started=Date.now();
        const characters=payload.reduce((sum,row)=>sum+JSON.stringify(row).length,0);
        const outcome=await insertImportBatches(payload,{
          batchSize:insertSizer.size,
          // The Gateway reports SQLSTATE 23505 without naming its constraint.
          // Verify the UID really exists before treating it as an article collision.
          verifyUidConflict:async uid=>(await readRowsByUid([uid]))
            .some(row=>String(row.uid)===uid),
          writeBatch:batch=>insertImportRows(galaxy,batch.map(record=>({
            ...record,place_id:record.place_id??null,media_link:record.media_link??null
          })),{
            onValidationProgress:({completed,total})=>setProgress(previous=>
              previous?{...previous,detail:'Galaxy ZModel／Zod 已驗證 '+completed+' / '+total}:previous)
          })
        });
        result.inserted+=outcome.inserted;
        result.conflicts+=outcome.conflicts;
        for(const uid of outcome.insertedUids)result.insertedUids.add(uid);
        for(const uid of outcome.conflictedUids)result.conflictedUids.add(uid);
        newArticleProcessed+=payload.length;
        payload=[];payloadBytes=0;
        insertSizer.observe(count,Date.now()-started,characters);
        checkpointBatch('insert',newArticleProcessed,newArticleTotal,
          result.inserted,result.conflicts);
        showProgress('新增文章',newArticleProcessed,newArticleTotal);
      };
      for(const record of unique){
        if(existingBySiteId.has(record.uid))continue;
        const placeUid=importedPlaceId({incoming:record,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
        const {__importCoordinates:unusedCoordinates,
          __importPlaceName:unusedPlaceName,__importPlaceAddress:unusedPlaceAddress,
          __importPlaceUrl:unusedPlaceUrl,__importCheckin:unusedCheckin,
          __importTimeSource:unusedTimeSource,
          ...article}=record;
        const incoming=placeUid?{...article,place_id:placeUid}:article;
        const bytes=insertSizer.byteSize(incoming);
        if(insertSizer.shouldFlush(payload.length,payloadBytes,bytes))
          await flushNewArticles();
        payload.push(incoming);payloadBytes+=bytes;
        if(insertSizer.shouldFlush(payload.length,payloadBytes))
          await flushNewArticles();
      }
      await flushNewArticles();
      duplicateCount+=result.conflicts;
      for(const uid of result.insertedUids)knownArticleIds.set(uid,uid);
      for(const record of analyzed.valid){
        const canonical=incoming.aliases.get(record.uid)||record.uid;
        const savedUid=knownArticleIds.get(canonical);
        if(savedUid)knownArticleIds.set(record.uid,savedUid);
      }
      showProgress('整理媒體資料');
      const finalizedTimes=new Map(unique.map(row=>[String(row.uid),row.createtime]));
      const articleTimes=new Map(analyzed.valid.map(row=>[
        String(row.uid),
        finalizedTimes.get(String(incoming.aliases.get(row.uid)||row.uid))||row.createtime
      ]));
      const articleTitles=new Map(analyzed.valid.map(row=>[String(row.uid),row.title]));
      const articleContents=new Map(analyzed.valid.map(row=>[String(row.uid),row.content]));
      const archivePlan=prepareArchiveMedia(
        eligibleArchiveEvidence,new Set(knownArticleIds.keys()),articleTimes,
        articleTitles,articleContents);
      const canonicalArchiveMedia=archivePlan.media.map(record=>({
        ...record,__article_uid:knownArticleIds.get(String(record.__article_uid||''))||null
      }));
      const importedUids=new Set(analyzed.valid.map(row=>String(row.uid)));
      const safeMediaOnly=analyzed.mediaOnly.map(record=>{
        const owner=String(record.__article_uid||'');
        return importedUids.has(owner)?
          {...record,__article_uid:knownArticleIds.get(owner)||null,
            createtime:record.createtime||articleTimes.get(owner)||null}:record;
      });
      const visualType=row=>canonicalMediaAnchorType(row.type||row.media_type,row.url);
      const isVisual=row=>['image','video'].includes(visualType(row));
      const visualRecords=[
        ...analyzed.normalized.flatMap(item=>(item.mediaRecords||[]).filter(isVisual)),
        ...safeMediaOnly.filter(isVisual),
        ...canonicalArchiveMedia.filter(isVisual)
      ].map(row=>({...row,type:visualType(row)}));
      const articlesByUid=new Map();
      for(const row of analyzed.valid){
        articlesByUid.set(String(row.uid),row);
        const saved=knownArticleIds.get(String(row.uid));
        if(saved)articlesByUid.set(String(saved),row);
      }
      const images=await syncImportedVisualGalaxies({
        records:visualRecords,knownArticleIds,articlesByUid,galaxy,
        onProgress:p=>showProgress(p.stage,p.completed,p.total||0)
      });
      const mediaSummary=await syncImportedMedia({
        normalized:analyzed.normalized.map(item=>({
          ...item,mediaRecords:(item.mediaRecords||[]).filter(row=>!isVisual(row))
        })),
        mediaOnly:[...safeMediaOnly,...canonicalArchiveMedia].filter(row=>!isVisual(row)),
        extraLinks:archivePlan.mediaLinks,
        knownArticleIds,scopeId,galaxy,mediaAnchor,t,
        onProgress:p=>showProgress(p.stage,p.completed,p.total||0)
      });
      // Media and article stages are both confirmed, but cleanup still waits
      // for the rest of the import to finish (including Search refresh).
      checkpointBatch('media',checkedExisting+newArticleProcessed,
        existingCount+newArticleTotal,result.inserted+updated,result.conflicts);
      // All article and media writes are finished: now recompute the
      // persisted Search summary once. A summary error must not turn a
      // successful import into a retry-all error.
      if(!nativeLocal)await refreshImportedSearchSummary();
      // SiteAnchor is the global silver.loc_anchor source taxonomy, NOT an
      // article foreign key or a second publisher identity. Audit the source
      // labels once after successful writes; ambiguity is informational and
      // never rewrites Galaxy.site or triggers a second import attempt.
      let sourceAudit={conflicts:[]},sourceAuditWarning='';
      if(!nativeLocal&&distinctSites.length){
        try{
          showProgress('核對 SiteAnchor 來源歧義');
          sourceAudit=auditImportedSourceSites(distinctSites,
            await readPublicSourceTaxonomy());
        }catch{
          sourceAuditWarning='；SiteAnchor 來源分類核對未完成，原始文章與匯入結果不受影響。';
        }
      }
      const skipped=analyzed.invalid.length+analyzed.skippedByRange+
        duplicateCount+ambiguousGroups.length;
      showProgress('匯入完成',1,1);
      setStatus(t('uiExtra.importUI.importLinkedComplete',{articles:result.inserted,media:mediaSummary.created,linked:mediaSummary.connected,skipped})+
        '；圖片／影片 Galaxy 新增 '+images.created.toLocaleString()+' 筆，沿用 '+
        images.existing.toLocaleString()+' 筆'+
        (images.conflicts?'，重複關聯待確認 '+images.conflicts.toLocaleString()+' 筆':'')+'。'+
        (result.conflicts?'；UID 衝突未建立文章／媒體關聯 '+result.conflicts.toLocaleString()+' 筆。':'')+
        '；已更新既有文章 '+updated.toLocaleString()+' 筆，沿用空間定錨點 '+placeAnchors.reused.toLocaleString()+' 筆，新增空間定錨點 '+placeAnchors.created.toLocaleString()+' 筆，新增日期定錨 '+timeAnchors.created.toLocaleString()+' 筆，沿用日期定錨 '+timeAnchors.reused.toLocaleString()+' 筆，未匹配地點 '+placeAnchors.unmatchedCoordinates.toLocaleString()+' 組。'+importAnchorConflictSummary(placeAnchors,timeAnchors,mediaSummary,sourceAudit)+sourceAuditWarning+
        (missingPointUids.size?'；發現 '+missingPointUids.size.toLocaleString()+' 個既有 place_id 在 Point UID 索引中不存在，未依 location 重建或改指向其他地點。UID：'+[...missingPointUids].slice(0,5).join(',')+(missingPointUids.size>5?' 等':'')+'。':'')+
        (ambiguousGroups.length?'；來源文章 ID 或發文時間對應多篇既有文章，無法唯一比對而暫不匯入 '+
          ambiguousGroups.length.toLocaleString()+' 筆（其他文章繼續處理）。待確認：'+
          ambiguousGroups.slice(0,5).map(group=>'UID '+String(group.uid)+' / '+
            group.site+' / '+(group.site_id||group.createtime)+
            (group.saved_uids?.length?'，候選 UID '+group.saved_uids.slice(0,5).join(',')+
              (group.saved_uids.length>5?'…':''):'')).join('、')+
            (ambiguousGroups.length>5?' 等':'')+'。':''));
      releaseCompletedFile();
      if(nativeLocal)window.dispatchEvent(new Event('loc-local-data-changed'));
    }catch(error){
      // Critical cleanup: SQL/network errors previously left the entire
      // decoded import in React state until the page was closed. Do not drop
      // the File handle: allow the user to reparse, inspect and explicitly
      // rerun the existing deduplicating import.
      clearDecodedFile();
      setReparseRequired(true);
      setStatus('匯入在「'+lastImportStage+'」階段失敗；之前成功的批次可能已寫入。原始錯誤：'+
        String(error?.message||error||t('uiExtra.importUI.importFailed'))+
        t('uiExtra.importUI.importRetry'));
    }
    finally{setBusy(false);}
  }
  async function chooseImportLocale(event){
    if(busy)return;
    const next=event.target.value;
    setImportLocale(next);
    if(queue[queueIndex])await loadQueuedFile(queue[queueIndex],queueIndex,queue.length,next);
  }
  function changeImportFormat(next){
    if(busy)return;
    onFormatChange(next);
    // A changed record path changes the parsed file, not just field mapping.
    // Reparse the queued file in place instead of resetting the whole import.
    if(next.recordPath!==format.recordPath&&queue[queueIndex])
      void loadQueuedFile(queue[queueIndex],queueIndex,queue.length,importLocale,next.recordPath);
  }
  const pending=queue.length>queueIndex+1;
  const mixedArchive=Boolean(archiveDetection&&source==='Mixed');
  return <div className="scope-import-body">
    <div className="scope-import-primary-row">
      <label className="scope-import-source-choice">匯入來源（ZModel）
        <select className="scope-select" value={mixedArchive?'__mixed__':sourceSelection}
          disabled={busy||mixedArchive} onChange={event=>chooseSource(event.target.value)}>
          <option value="">請選擇來源模型</option>
          <option value="__mixed__" disabled>混合來源 ZIP（按原始來源逐筆處理）</option>
          {sourceOptions.map(name=><option key={name} value={name}>{name}</option>)}
          <option value="__custom__">其他／自訂來源（通用格式）</option>
        </select>
        <small className="scope-import-range-hint">
          {mixedArchive?'混合 ZIP 已逐筆辨識來源，保留每筆原始 Site，無法強制套用單一模型'
            :sourceSelection&&sourceSelection!=='__custom__'
              ?'已選擇來源；自動套用相應欄位模型'
              :suggestedModel?'檔名建議：'+suggestedModel+'（不自動套用）'
                :'請選擇來源；沒有模型時可使用通用格式'}
        </small>
      </label>
      <label><UiText id="uiExtra.importUI.importLanguage"/>
        <select className="scope-select" value={importLocale} disabled={busy} onChange={chooseImportLocale}>
          {UI_LOCALE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label><UiText id="uiExtra.importUI.fileSource"/>
        <input type="file" accept={UNIVERSAL_IMPORT_ACCEPT} multiple disabled={busy} onChange={chooseFile}/>
      </label>
    </div>
    <div className="scope-import-options-row">
    {sourceSelection==='__custom__'&&!mixedArchive?<label className="scope-import-source-choice">
      <UiText id="uiExtra.importUI.sourceLabel"/>
      <input type="text" list={'scope-import-sources-'+scopeId} maxLength={80} required
        value={source} onChange={event=>setSource(event.target.value)}
        disabled={busy} placeholder="自訂來源名稱"/>
      <datalist id={'scope-import-sources-'+scopeId}>
        {sourceOptions.map(name=><option key={name} value={name}/>)}
      </datalist>
    </label>:null}
    <label className="scope-import-source-choice">匯入時間範圍
      <select value={timeRange} disabled={busy} onChange={event=>setTimeRange(event.target.value)}>
        <option value="all">全部的時間（預設）</option>
        <option value="year">近一年</option>
        <option value="halfYear">近半年</option>
        <option value="month">近一月</option>
      </select>
      <small className="scope-import-range-hint">{timeWindow?timeWindow.start.slice(0,10)+' 至 '+timeWindow.end.slice(0,10):'不限日期'}</small>
    </label>
    </div>
    <ImportFormatSettings format={format} onChange={changeImportFormat} disabled={busy}/>
    {rows.length&&!archiveDetection&&!sourceSelection
      ?<p className="scope-status" role="status">資料已讀取。請先在上方選擇來源模型，才會建立匯入預覽。</p>
      :null}
    {fileName?<p><UiText id="uiExtra.importUI.fileLabel"/><strong>{fileName}</strong><UiText id="uiExtra.importUI.fileQueue" params={{index:queueIndex+1,total:queue.length}}/><strong>{archiveDetection?(archiveDetection.sources.map(kind=>ZIP_SOURCE_NAMES[kind]||kind).join(' / ')||t('uiExtra.importUI.zipUnknown')):source||suggested}</strong></p>:null}
    {checkpointHint&&!busy&&rows.length?<details className="loc-work-subdetails">
      <summary>上次中斷的檢查點</summary>
      <p className="scope-status">
        已確認 {Number(checkpointHint.confirmed).toLocaleString()} / {Number(checkpointHint.total).toLocaleString()} 筆的
        {checkpointHint.phase==='update'?'文章更新':checkpointHint.phase==='insert'?'文章新增':'文章與媒體階段'}。
        這是先前的寫入回執，不是續傳游標；重新匯入仍會核對所有來源 UID，不會直接略過。
      </p>
    </details>:null}
    {rows.length||eligibleArchiveMediaPlan.media.length?<section className="scope-import-save" aria-label={t('uiExtra.importUI.saveSection')}>
      <button type="button" className="loc-button primary scope-import-save-button"
        disabled={busy||!analysisCurrent||(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveMediaPlan.media.length)} onClick={run}>
        {busy?UI_COPY.management.importing:t('uiExtra.importUI.batchImport')}
      </button>
      <div className="scope-import-save-summary">
        {!busy&&analysisCurrent?<p className="scope-import-ready-counts">{t('uiExtra.importUI.importReadyCounts',{articles:analyzed.valid.length.toLocaleString(),media:(analyzed.mediaOnly.length+eligibleArchiveMediaPlan.media.length).toLocaleString()})}</p>:null}
        {!busy&&analysisCurrent&&analyzed.warnings?.length?<p className="scope-status" role="status">
          {analyzed.warnings.length.toLocaleString()} 筆含未支援的附件型別，文字文章仍可匯入；例如：{analyzed.warnings[0]}
        </p>:null}
      </div>
    </section>:null}
    {rows.length&&!busy&&!analysisCurrent?<p className="scope-status" role="status">
      正在按所選 ZModel 整理匯入預覽：{analysisProgress.completed.toLocaleString()}／{analysisProgress.total.toLocaleString()} 筆。完成後才會開放寫入。
    </p>:null}
    {rows.length&&!busy&&analysisCurrent&&!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveMediaPlan.media.length?<p className="scope-status" role="status">目前沒有可匯入的有效紀錄。已排除 {analyzed.invalid.length.toLocaleString()} 筆格式無效資料、{analyzed.skippedByRange.toLocaleString()} 筆不在指定時間內。{analyzed.invalid[0]?.error||'請核對來源及進階資料路徑。'}</p>:null}
    {busy?<FlowProgress kind="import" stage={progress?.stage||'準備匯入資料'}
      completed={progress?.completed||0} total={progress?.total||0}
      detail={progress?.detail||''}/>:null}
    {busy&&parsingJson?<button type="button" className="loc-button"
      onClick={cancelJsonParse}>取消 JSON 解析</button>:null}
    {/* Rendered right under the import button/progress area, not after every
        intermediate ZIP/archive detail section below — the user is watching
        here, and a result (success, "no changes", or an error like the
        ambiguous-duplicate abort) buried past a long ZIP summary goes unseen. */}
    {status&&!busy?<div className="loc-work-status" role={reparseRequired?'alert':'status'}>
      <strong>{status.startsWith('匯入在「')?'匯入中斷，請查看原因':'匯入狀態已更新'}</strong>
      <details className="loc-work-subdetails">
        <summary>查看完整結果與處理紀錄</summary>
        <p className="scope-status scope-import-live-status">{status}</p>
      </details>
    </div>:null}
    {reparseRequired&&!busy&&queue[queueIndex]?<div className="scope-preview-links" role="group" aria-label="匯入中斷處理">
      <button type="button" className="loc-button primary" onClick={retryFailedFile}>
        重新解析原始檔並核對
      </button>
      <button type="button" className="loc-button" onClick={discardFailedFile}>
        釋放原始檔
      </button>
      <p className="scope-status">已清空解析後的文章與媒體暫存。重新解析不會自動寫入；
        確認資料後再匯入，系統會重新比對既有文章。</p>
    </div>:null}
    {!nativeLocal&&scopeId!=='loc'?<div className="scope-import-summary-refresh">
      <button type="button" className="loc-button" disabled={busy||summaryRefreshing}
        onClick={refreshImportedSearchSummary}>
        {summaryRefreshing?'正在更新搜尋統計…':'更新搜尋統計（總文章數、總文字量）'}
      </button>
      {summaryMessage?<p role="status" className={'scope-status'+(summaryError?' scope-error':'')}>{summaryMessage}</p>:null}
    </div>:null}
    {!nativeLocal&&scopeId!=='loc'?<details className="scope-import-maintenance">
      <summary>既有地點與日期定錨修復</summary>
      <div className="scope-import-maintenance-content">
        <p className="scope-status">已匯入文章若有地點，可補齊空間與日期定錨、文章地點關聯，以 place_id 保留已知 Point 關聯，不依 location 文字重配既有 UID。原始文章及其 createtime 保留在 Galaxy；不新增文章或覆寫 Point。</p>
        <button type="button" className="loc-button" disabled={busy} onClick={restoreExistingAnchors}>
          {busy?'正在檢查地點關聯…':'補齊既有文章的地點與日期定錨'}
        </button>
      </div>
    </details>:null}
    {archiveDetection?<details className="scope-import-preview loc-work-disclosure" aria-label={t('uiExtra.importUI.zipDetected')}>
      <summary>{t('uiExtra.importUI.zipDetected')} · {archiveDetection.sources.map(kind=>ZIP_SOURCE_NAMES[kind]||kind).join(' / ')||t('uiExtra.importUI.zipUnknown')}</summary>
      <dl className="scope-import-facts">
        <div><dt>{t('uiExtra.importUI.zipDetected')}</dt><dd>{archiveDetection.sources.map(kind=>ZIP_SOURCE_NAMES[kind]||kind).join(' / ')||t('uiExtra.importUI.zipUnknown')}</dd></div>
        <div><dt>{t('uiExtra.importUI.zipConfidence')}</dt><dd>{t(archiveDetection.confidence===3?'uiExtra.importUI.zipVerified':archiveDetection.confidence?'uiExtra.importUI.zipPossible':'uiExtra.importUI.zipUnknown')}</dd></div>
        {archiveDetection.evidence.length?<div><dt>{t('uiExtra.importUI.zipEvidence')}</dt><dd>{archiveDetection.evidence.map(item=>item.path).join('、')}</dd></div>:null}
        {Object.keys(archiveDetection.structure?.layouts||{}).length?<div><dt>{t('uiExtra.importUI.zipLayouts')}</dt><dd>{Object.entries(archiveDetection.structure.layouts).map(([kind,count])=>
          t('uiExtra.importUI.zipLayout.'+(ZIP_LAYOUT_KEYS[kind]||'records'))+' '+count).join('、')}</dd></div>:null}
        {Object.keys(archiveDetection.structure?.formats||{}).length?<div><dt>{t('uiExtra.importUI.zipFormats')}</dt><dd>{Object.entries(archiveDetection.structure.formats).map(([kind,count])=>kind.toUpperCase()+' '+count).join('、')}</dd></div>:null}
        {ZIP_FIELD_KEYS.some(key=>archiveDetection.structure?.fields?.[key])?<div><dt>{t('uiExtra.importUI.zipFields')}</dt><dd>{ZIP_FIELD_KEYS.filter(key=>archiveDetection.structure?.fields?.[key]).map(key=>
          t('uiExtra.importUI.zipField.'+key)).join('、')}</dd></div>:null}
      </dl>
      <p className="scope-status">{t('uiExtra.importUI.zipStructureCount',{count:archiveDetection.structure?.sampledFiles||0})}</p>
      {archiveDetection.audit?<details className="scope-import-audit">
        <summary>{t('uiExtra.importUI.zipAuditTitle')}</summary>
        <p>{t('uiExtra.importUI.zipAuditFiles',{
          total:archiveDetection.audit.files.allFiles,
          sampled:archiveDetection.audit.files.sampled,
          remaining:archiveDetection.audit.files.notInspected,
          partial:archiveDetection.audit.files.partialSamples
        })}</p>
        <p>{t('uiExtra.importUI.zipAuditAssets',{count:archiveDetection.audit.files.assets})}</p>
        <p>{t('uiExtra.importUI.zipAuditProjects',{
          files:archiveDetection.audit.projects.possibleProjectFiles,
          linked:archiveDetection.audit.projects.additionalFilesWithProjectFields,
          refs:archiveDetection.audit.projects.sampleReferences.length
        })}</p>
        {archiveDetection.audit.projects.observedFields.length?<p>
          {t('uiExtra.importUI.zipProjectFields')}：{archiveDetection.audit.projects.observedFields.join('、')}
        </p>:null}
        {archiveDetection.audit.attention.length?<ul>{archiveDetection.audit.attention.slice(0,10).map((item,i)=>
          <li key={i}>{item.path} — {t('uiExtra.importUI.zipAuditReason.'+item.reason)}</li>)}</ul>:null}
        <p>{t('uiExtra.importUI.zipAuditCaveat')}</p>
      </details>:null}
      <p className="scope-status">{t('uiExtra.importUI.zipReadOnly')}</p>
    </details>:null}
    {archiveDetection?.fileInventory||archiveSummary?<details className="loc-work-disclosure loc-work-audit">
      <summary>檔案掃描與對帳明細</summary>
    {archiveDetection?.fileInventory?<p className="scope-status">
      ZIP 完整清點：{archiveDetection.fileInventory.allFiles.toLocaleString()} 個檔案，其中 JSON {archiveDetection.fileInventory.jsonFiles.toLocaleString()} 個（私人對話候選 JSON {archiveDetection.fileInventory.privateJsonFiles.toLocaleString()} 個）。前面的資料結構辨識是抽樣，不代表只掃描這些檔案。
    </p>:null}
    {archiveSummary?<p className="scope-status">
      JSON 核對：共 {archiveSummary.jsonFilesSeen.toLocaleString()} 個；完成解析 {archiveSummary.jsonFilesParsed.toLocaleString()}、私人對話排除 {archiveSummary.jsonFilesPrivate.toLocaleString()}、格式未辨識 {archiveSummary.jsonFilesUnrecognized.toLocaleString()}、檔案過大 {archiveSummary.jsonFilesOversize.toLocaleString()}、其他不支援 {archiveSummary.jsonFilesUnsupported.toLocaleString()}。
      {archiveDetection?.fileInventory&&archiveDetection.fileInventory.jsonFiles!==archiveSummary.jsonFilesSeen?' ZIP 清點與解析掃描的 JSON 總數不一致，請先核對來源檔案。':''}
      {archiveSummary.jsonFilesSeen!==archiveSummary.jsonFilesParsed+archiveSummary.jsonFilesPrivate+archiveSummary.jsonFilesUnrecognized+archiveSummary.jsonFilesOversize+archiveSummary.jsonFilesUnsupported?' JSON 數量尚未完全對帳，請勿視為完整匯入。':''}
      原始紀錄 {archiveSummary.totalRows.toLocaleString()} 筆，解析接受 {archiveSummary.acceptedRows.toLocaleString()} 筆，解析拒絕 {archiveSummary.rejectedRows.toLocaleString()} 筆；解析接受不等於最終寫入成功。
    </p>:null}
    {archiveSummary?.urlAudit?<p className="scope-status">
      原始 JSON 巢狀 url 屬性核對：總計 {archiveSummary.urlAudit.total.toLocaleString()} 個；
      文章候選 {archiveSummary.urlAudit.article.toLocaleString()}、媒體／附件 {archiveSummary.urlAudit.media.toLocaleString()}、
      地點 {archiveSummary.urlAudit.place.toLocaleString()}、其他 {archiveSummary.urlAudit.other.toLocaleString()}。
      這是來源欄位出現次數，不等於已保存的公開 URL。
      {archiveSummary.urlAudit.truncated?' 有 '+archiveSummary.urlAudit.truncated.toLocaleString()+' 筆超過掃描上限；數量為下限。':''}
    </p>:null}
    {archiveSummary?<p className="scope-status">文章原始網址 {Number(archiveSummary.articleWithUrl||0).toLocaleString()}／{rows.length.toLocaleString()} 篇；未取得網址的文章不會以 ZIP uri、媒體連結或來源 ID 偽造文章 URL。</p>:null}
    {archiveSummary?<p className="scope-status">已清點 {archiveSummary.mediaFiles.toLocaleString()} 個 ZIP 媒體檔；符合文章關聯的媒體候選 {archiveSummary.mediaImportable.toLocaleString()} 筆（有公開網址 {archiveSummary.mediaWithUrl.toLocaleString()} 筆、無公開網址但已確認 ZIP 檔案 {archiveSummary.mediaZipLinked.toLocaleString()} 筆），未匹配或不支援的 ZIP 媒體約 {archiveSummary.mediaZipNotLinked.toLocaleString()} 筆。依目前時間範圍可建立 {eligibleArchiveMediaPlan.media.length.toLocaleString()} 筆媒體紀錄。僅 ZIP 附件會建立 UID 及文章 media_link，URL 保留空值；不會上傳圖片或影片檔案，也不會用 ZIP 路徑冒充播放網址。</p>:null}
    </details>:null}
    {archiveSummary&&(
      (archiveDetection?.fileInventory&&archiveDetection.fileInventory.jsonFiles!==archiveSummary.jsonFilesSeen)||
      archiveSummary.jsonFilesSeen!==archiveSummary.jsonFilesParsed+archiveSummary.jsonFilesPrivate+
        archiveSummary.jsonFilesUnrecognized+archiveSummary.jsonFilesOversize+
        archiveSummary.jsonFilesUnsupported
    )?<p className="scope-status scope-error" role="alert">檔案數量尚未完全對帳，請展開「檔案掃描與對帳明細」核對。</p>:null}
    {archiveSummary?.geoPlaceObjects?<section className="scope-import-preview" aria-label="Facebook 地點候選">
      <p className="scope-status">Facebook 原始地點物件 {archiveSummary.geoPlaceObjects.toLocaleString()} 筆。匯入時會按原始地名建立缺少的空間定錨與日期定錨；已有的沿用，經緯度不足時不推測。獨立打卡不會轉成 Galaxy 文章。</p>
      {geoPlaceCandidates.length?<ul>{geoPlaceCandidates.slice(0,12).map((place,index)=>
        <li key={index}>{place.location||'未提供地名'} · {place.__importCoordinates?
          place.__importCoordinates.latitude+', '+place.__importCoordinates.longitude:'未提供經緯度'}
          {place.placeUrl?' · '+place.placeUrl:''}</li>)}</ul>:null}
      {archiveSummary.geoPlaceObjects>geoPlaceCandidates.length?<p className="scope-status">來源地點事件多於合併後的地點候選；預覽僅顯示前 {geoPlaceCandidates.length.toLocaleString()} 筆。</p>:null}
    </section>:null}
    {canRestoreAnchors?<section className="scope-import-preview" aria-label="打卡定錨匯入">
      <p className="scope-status">將自動建立缺少的空間定錨與日期定錨；已有日期沿用。缺少經緯度仍保留原始地名，不推測座標。</p>
      {!rows.length&&!archiveEvidence.length?<button type="button" className="loc-button primary"
        disabled={busy||!eligibleGeoRecords.length} onClick={saveGeoPlaces}>
        {busy?'正在核對打卡定錨…':'匯入獨立打卡至空間與時間（不新增文章）'}
      </button>:null}
    </section>:null}
    {missingSiteIdCount>0?<p className="scope-status" role="status">
       Facebook／Threads／Instagram 有 {missingSiteIdCount.toLocaleString()} 筆沒有原始 site_id；仍按相同網站與發文時間比對，site_id 不必填寫。
     </p>:null}
     {rows.length?<details className="scope-import-preview loc-work-disclosure" aria-label={t('uiExtra.importUI.preview')}>
      <summary>{t('uiExtra.importUI.preview')} · {analyzed.valid.length.toLocaleString()} 篇</summary>
      <p className="scope-status"><UiText id="uiExtra.importUI.validSkipped" params={{valid:analyzed.valid.length.toLocaleString(),skipped:analyzed.invalid.length.toLocaleString()}}/> 此處為檔案解析結果，不代表本次會新增相同篇數；每次選取檔案都會重新解析，實際新增／更新／略過請以資料庫比對後的匯入結果為準。</p>
      {unidentifiedUndatedCount>0?<p className="scope-status" role="status">
        有 {unidentifiedUndatedCount.toLocaleString()} 筆同時缺少來源文章 ID 與原始發文時間。無法以目前的來源 ID／時間比對保證重匯去重；即使檔名相同也可能再次新增，請核對來源資料。
      </p>:null}
      <div className="scope-management-records">
        {analyzed.valid.slice(0,5).map(record=><article className="loc-bubble" key={record.uid}>
          <strong><LinkedImportText text={record.title||record.uid}/></strong>
          <span>{record.uid} · {record.site||'未選來源'} · {String(record.createtime||'').slice(0,10)||t('uiExtra.importUI.noDate')}</span>
          <p><LinkedImportText text={record.content} limit={180}/></p>
        </article>)}
      </div>
      {analyzed.invalid.length?<p className="scope-status"><UiText id="uiExtra.importUI.skippedReasons"/>{analyzed.invalid.slice(0,5).map(item=>item.error).join('、')}</p>:null}
    </details>:null}
    {pending&&!rows.length?<div className="scope-tabs"><button type="button" disabled={busy} onClick={nextFile}><UiText id="uiExtra.importUI.nextJson"/></button></div>:null}
  </div>;
}


export default function ManagementImportPanel({scopeId}){
  useUiSection('management');
  useUiSection('uiExtra.importUI');
  const [format,setFormat]=useState({recordPath:'',fields:{}});
  return <div className="scope-management-imports">
    <section className="loc-card scope-import-primary">
      <h2><UiText id="uiExtra.importUI.importTitle"/></h2>
      <UniversalImport scopeId={scopeId} format={format} onFormatChange={setFormat}/>
    </section>
    <BulkGalaxyVisibility scopeId={scopeId}/>
  </div>;
}
