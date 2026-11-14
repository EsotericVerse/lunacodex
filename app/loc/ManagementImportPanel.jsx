'use client';

import {useUiCopy,useUiLocale,useUiSection} from '../i18n/ui-locale';
import UiText,{useUiText} from '../i18n/UiText';
import {registerDefaultSection,UI_LOCALE_OPTIONS} from '../i18n/ui-copy';
import managementZh from '../i18n/sections/management.zh_tw.js';
import importUIZh from '../i18n/sections/uiExtra.importUI.zh_tw.js';
registerDefaultSection('management',managementZh);
registerDefaultSection('uiExtra.importUI',importUIZh);

import {useDeferredValue,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {refreshScopeSearchSummary} from './scope-search-summary.mjs';
import {insertRows,insertImportRows,dbAuthRelation,dbAuthClient,updateImportRows} from './db-client.mjs';
import {useAccount} from './use-account';
import ActivityMotion from '../modular/ActivityMotion';
import {useAsyncResource,useResourceCache} from '../../zenstack/client-queries';
import {canonicalImportSourceName,inferImportSourceFromFilename} from './source-name.mjs';
import {Capacitor} from '@capacitor/core';
import {defaultScopeData} from './scope-data';
import {createUid8} from './uid';
import {mediaAnchorRecord,mediaAnchorProjection,canonicalMediaAnchorType,MEDIA_ANCHOR_COLUMNS,ANCHOR_TYPE_GROUPS} from '../../zenstack/anchor-hierarchy.mjs';
import {createImportProgressStore} from './import-progress-store.mjs';
import {remapArchiveArticleUids} from './import-random-uids.mjs';
import {facebookBackupPlace,facebookBackupPostText,facebookBackupTimestamp} from './facebook-backup-place.mjs';
import {archiveGalaxyRows} from './archive-caption-rows.mjs';
import {facebookPostPlace} from './archive-geo-objects.mjs';

import {dedupeIncomingImport,matchExistingImportBySiteId,matchExistingImportByCreatedAt,readImportCandidatesByTimeWindows,isUnchangedImportBeforeWrite,insertImportBatches} from './import-duplicate-check.mjs';
import {importTimeRangeWindow,filterImportAnalysisByTime} from './import-time-range.mjs';
import {prepareImportPlaceAnchors,importedPlaceId,recordImportPlaceVisits} from './import-place-anchors.mjs';
import {prepareImportTimeAnchors} from './import-time-anchors.mjs';
import {readImportPointDateAnchors} from './import-anchor-read.mjs';
import {reconcileExistingImportAnchors} from './reconcile-import-anchors.mjs';
import {extractImportCoordinates,importGeoKey,importMapUrlCoordinates} from './import-geocoordinates.mjs';
import {isPublicArchiveRecord,filterStandalonePublicRows,assertStandaloneImportDestination} from './archive-import-safety.mjs';
import {createArchiveEvidenceCollector,prepareArchiveMedia,isArchiveMediaUrl,auditArchiveUrlAttributes} from './archive-media-evidence.mjs';
import {ARCHIVE_MAX_BYTES,IMPORT_FIELD_ALIASES,UNIVERSAL_IMPORT_ACCEPT,mappedImportValue,normalizeImportMedia,parseImportCreatedTime,extractImportCreatedAt,writeImportBatches,createImportBatchSizer,estimateImportMinutes,estimateImportStageMinutes} from './import-batch.mjs';
import {MAX_ROWS,urlSafeInBatches} from './query-batch-size.mjs';
import {hasIrrecoverableEncoding,isPureUrlContent,normalizeGalaxyContent,normalizeRelationIds,repairMojibakeText,resolveGalaxyTitle} from './content-policy';
import {galaxyAble} from './galaxy-able.mjs';
import BulkGalaxyVisibility from './BulkGalaxyVisibility';
import {touchEditorSession} from './edit-session-ttl.mjs';
import {PUBLISHED_LOC_ARTICLE_TAGS} from '../modular/published-source-taxonomy.js';
import {runeDrawText} from './rune-draw-text.mjs';
import {galaxyReadColumns,galaxyReadColumnsFor} from '../../zenstack/galaxy-read-models.mjs';
// The published LOC ArticleTag list is already bundled in the static site;
// never create an async query/resource just to read this in-memory constant.
// Keep one stable object so import analysis does not re-run on every UI repaint.
const PUBLISHED_SOURCE_CATEGORIES=Object.freeze({
  system:PUBLISHED_LOC_ARTICLE_TAGS,personal:Object.freeze([])
});
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

function normalizeJsonImportEntry(entry,source,fieldMap={},t){
  const row=entry?.raw||entry||{};
  const value=field=>mappedImportValue(row,field,fieldMap);
  const isFacebook=String(source||'').trim().toLowerCase()==='facebook';
  const isThreads=String(source||'').trim().toLowerCase()==='threads';
  const isInstagram=String(source||'').trim().toLowerCase()==='instagram';
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
  const createdAt=parseImportCreatedTime(rawDate)||extractImportCreatedAt(row);
  const originalSiteId=value('site_id')||((isFacebook||isThreads||isInstagram)?
    (row.post_id||row.id_str||row.id||(isThreads?row.thread_id:null)||
      (isInstagram?row.fbid:null)):null);
  // On social imports the source ID is optional metadata; Galaxy UID is
  // generated locally by the importer and never derived from source content.
  const uid=String(((isFacebook||isThreads||isInstagram)&&entry?.import_uid)||
    value('uid')||entry?.import_uid||createUid8()).trim();
  const rawUrl=String(value('url')||'').trim();
  const mediaCandidates=[value('media'),value('media_link'),
    ...(isArchiveMediaUrl(rawUrl)?[rawUrl]:[])]
    .filter(item=>item!==''&&item!==undefined&&item!==null);
  let mediaRecords=[],mediaRefs=[];
  const importedRuneReferences=value('rune_references');
  const runeResultText=runeDrawText(importedRuneReferences);
  try{
    for(const item of mediaCandidates){
      const media=normalizeImportMedia(item,{title:rawTitle,createtime:createdAt,location:sourcePlace,article_uid:uid});
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
    // A text article may carry a top-level card draw, even when the import
    // did not provide a nested media array. Attach one media record to its UID.
    if(content&&runeResultText)mediaRecords.push({
      __article_uid:uid,media_type:'rune',title:'抽牌結果',
      url:null,description:runeResultText,createtime:createdAt,location:sourcePlace||null
    });
  }catch(error){return {record:null,error:String(error.message||error)}}
  if(!content){
    const type=String(value('media_type')||(runeResultText?'rune':'')).trim();
    const url=String(value('url')||'').trim();
    if(type){
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
    location:sourcePlace||null,
    ...(explicitCheckin?{__importCheckin:true}:{}),
    ...(importedCoordinates?{__importCoordinates:importedCoordinates,
      ...(importPlaceName?{__importPlaceName:importPlaceName}:{}),
      ...(importPlaceAddress?{__importPlaceAddress:importPlaceAddress}:{}),
      ...(importPlaceUrl?{__importPlaceUrl:importPlaceUrl}:{})}:{}),
    ...galaxyAble({
      site:String(source||'').trim(),
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
    url:!isArchiveMediaUrl(rawUrl)&&!importMapUrlCoordinates(rawUrl)?rawUrl||null:null,
    ...(mediaRefs.length?{media_link:mediaRefs}:{}),
    site:String(source||'').trim()
  };
  return {record,mediaRecords,mediaRefs,error:''};
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

// A GET .in() filter has a URL budget, unlike POST imports.
// Count and page each query until all matched rows are returned.
async function readExistingByIds(table,columns,column,values,message,onPage){
  const records=[],orderColumn='uid';
  // SELECT comparison pages are independent of the unchanged 1000-row write batch.
  const pageSize=500;
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
  const ids=[...new Set(uids.map(value=>String(value||'').trim()).filter(Boolean))];
  const links=[...new Set(urls.map(value=>String(value||'').trim()).filter(Boolean))];
  if(scopeId==='local'){
    if(links.length)throw new Error('本機媒體 URL 去重尚無 SQL 查詢能力，已停止匯入避免重複資料。');
    const rows=await readExistingByIds(anchor,MEDIA_ANCHOR_COLUMNS,'uid',ids,message);
    return rows.filter(row=>ANCHOR_TYPE_GROUPS.media.includes(row.type)).map(mediaAnchorProjection);
  }
  const out=new Map();
  for(let offset=0;offset<Math.max(ids.length,links.length);offset+=200){
    const {data,error}=await dbAuthClient.schema('silver').managedAction(
      'media_anchor_candidates',{p_scope_id:scopeId,
        p_uids:ids.slice(offset,offset+200),p_urls:links.slice(offset,offset+200)});
    if(error)throw new Error(error.message||message);
    if(!Array.isArray(data))throw new Error('MediaAnchor lookup response invalid');
    for(const row of data)out.set(String(row.uid),row);
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
        const url=String(row.url||'').trim();
        return url?JSON.stringify([url,String(row.type||'').trim()])
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
      // URL-less media are reused only when attached to this exact article
      // with a complete, matching source evidence identity.
      const mediaEvidenceKey=(item,owner)=>{
        const type=String(item?.type||'').trim();
        const metadata=String(item?.description||'').trim();
        const title=String(item?.title||'').trim();
        const stamp=Date.parse(String(item?.createtime||''));
        if(!owner||!type||!metadata||!title||!Number.isFinite(stamp))return '';
        return JSON.stringify([owner,type,title,metadata,new Date(stamp).toISOString()]);
      };
      const pendingOwners=[...new Set(plans.filter(item=>
        !item.uid&&!item.url&&item.__article_uid&&
        (item.type==='rune'&&item.description||
          mediaEvidenceKey(item,String(item.__article_uid))))
        .map(item=>String(item.__article_uid)))];
      const existingRuneByArticle=new Map(),existingOwnerMediaByKey=new Map();
      const ambiguousRunes=new Map(),ambiguousEvidence=new Map();
      const trackEvidence=(stored,ambiguous,key,uid)=>{
        if(!key)return;
        if(ambiguous.has(key))ambiguous.get(key).add(uid);
        else if(stored.has(key)&&stored.get(key)!==uid){
          ambiguous.set(key,new Set([stored.get(key),uid]));stored.delete(key);
        }else stored.set(key,uid);
      };
      if(pendingOwners.length){
        const ownerRows=await readExistingByIds(galaxy,'uid,media_link','uid',pendingOwners,
          t('uiExtra.importUI.mediaLinkReadFailed'));
        const linkedUids=[...new Set(ownerRows.flatMap(row=>Array.isArray(row.media_link)?row.media_link:[]))];
        const linkedMedia=linkedUids.length?await readImportMediaCandidates(
          scopeId,mediaAnchor,linkedUids,[],t('uiExtra.importUI.mediaIdCompareFailed')):[];
        const savedMediaByUid=new Map(linkedMedia.map(row=>[String(row.uid),row]));
        for(const article of ownerRows){
          for(const mediaUid of article.media_link||[]){
            const stored=savedMediaByUid.get(String(mediaUid));
            if(!stored)continue;
            const owner=String(article.uid),uid=String(mediaUid);
            if(stored.type==='rune'&&stored.description)
              trackEvidence(existingRuneByArticle,ambiguousRunes,
                JSON.stringify([owner,String(stored.description)]),uid);
            if(!stored.url)
              trackEvidence(existingOwnerMediaByKey,ambiguousEvidence,
                mediaEvidenceKey(stored,owner),uid);
          }
        }
      }
      const createMedia=[],pendingMediaUids=new Set(),related=new Map(),seenMedia=new Set(),resolvedIds=new Map();
      const mediaSizer=createImportBatchSizer();
      let created=0;
      const flushNewMedia=async()=>{
        if(!createMedia.length)return;
        const count=createMedia.length,started=Date.now();
        await writeImportBatches(createMedia,{
          writeBatch:batch=>insertImportRows(mediaAnchor,batch.map(mediaAnchorRecord)),
          onProgress:p=>onProgress?.({stage:'新增媒體紀錄',completed:created+p.completed,total:created+count})
        });
        created+=count;
        createMedia.length=0;
        pendingMediaUids.clear();
        mediaSizer.observe(count,Date.now()-started);
      };
      function attach(uid,id){
        if(!uid||!id)return;
        if(!related.has(uid))related.set(uid,new Set());
        related.get(uid).add(id);
      }
      for(const item of normalized){
        const uid=knownArticleIds.get(item.record?.uid);
        for(const mediaId of item.mediaRefs||[]){
          if(!byId.has(mediaId))throw new Error(t('uiExtra.importUI.missingMediaReference',{id:mediaId}));
          attach(uid,mediaId);
        }
      }
      for(const raw of plans){
        const owner=String(raw.__article_uid||'').trim();
        const record={...raw};delete record.__article_uid;
        if(String(record.location||'').trim()&&!owner)
          throw new Error('未連結文章的媒體地點無法儲存到 MediaAnchor；請先建立文章／LocationAnchor。');
        const runeDedupKey=record.type==='rune'&&!record.uid&&!record.url&&owner&&record.description
          ?JSON.stringify([owner,String(record.description)]):'';
        if(runeDedupKey&&ambiguousRunes.has(runeDedupKey)){
          reportMediaConflict('rune:'+runeDedupKey,record,ambiguousRunes.get(runeDedupKey));
          continue;
        }
        const existingRuneUid=runeDedupKey?existingRuneByArticle.get(runeDedupKey):null;
        if(existingRuneUid){attach(owner,existingRuneUid);continue;}
        const evidenceKey=!record.uid&&!record.url?mediaEvidenceKey(record,owner):'';
        if(evidenceKey&&ambiguousEvidence.has(evidenceKey)){
          reportMediaConflict('evidence:'+evidenceKey,record,ambiguousEvidence.get(evidenceKey));
          continue;
        }
        const storedEvidenceUid=evidenceKey?existingOwnerMediaByKey.get(evidenceKey):null;
        if(storedEvidenceUid){attach(owner,storedEvidenceUid);continue;}
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
          attach(owner,known.uid);continue;
        }
        if(key&&seenMedia.has(key))continue;
        if(key)seenMedia.add(key);
        const mediaId=record.uid||createUid8();
        if(!mediaId)throw new Error(t('uiExtra.importUI.mediaUuidUnavailable'));
        record.uid=mediaId;
        if(runeDedupKey)existingRuneByArticle.set(runeDedupKey,String(mediaId));
        if(evidenceKey)existingOwnerMediaByKey.set(evidenceKey,String(mediaId));
        createMedia.push(record);pendingMediaUids.add(String(mediaId));
        if(key)byKey.set(key,record);byId.set(mediaId,record);
        attach(owner,mediaId);
        if(createMedia.length>=mediaSizer.size)await flushNewMedia();
      }
      await flushNewMedia();
      for(const link of extraLinks){
        const uid=knownArticleIds.get(String(link.uid||'').trim());
        const mediaId=resolvedIds.get(String(link.media_uid||''))||String(link.media_uid||'');
        if(uid&&byId.has(mediaId))attach(uid,mediaId);
      }
      let connected=0,checkedLinks=0;
      const linkedUids=[...related.keys()];
      const linkSizer=createImportBatchSizer();
      let linkQueue=[];
      const flushMediaLinks=async()=>{
        if(!linkQueue.length)return;
        const count=linkQueue.length,started=Date.now();
        const result=await updateImportRows(galaxy,linkQueue);
        connected+=result.count;
        linkQueue=[];
        linkSizer.observe(count,Date.now()-started);
      };
      onProgress?.({stage:'讀取文章媒體連結',completed:0,total:linkedUids.length});
      await readExistingByIds(galaxy,'uid,media_link','uid',linkedUids,
        t('uiExtra.importUI.mediaLinkReadFailed'),async page=>{
          for(const row of page){
            const uid=String(row.uid||'').trim();
            const prior=Array.isArray(row.media_link)?row.media_link.map(String):[];
            const linked=new Set(prior);
            const additions=[...(related.get(uid)||[])].filter(id=>!linked.has(String(id)));
            if(additions.length){
              linkQueue.push({uid,media_link:[...prior,...additions]});
              if(linkQueue.length>=linkSizer.size)await flushMediaLinks();
            }
            checkedLinks++;
          }
          onProgress?.({stage:'更新文章媒體連結',completed:checkedLinks,total:linkedUids.length});
        });
      await flushMediaLinks();

  return {created,connected,resolvedIds,conflicts:mediaConflicts};
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
  const [timeRange,setTimeRange]=useState('year');
  const timeWindow=useMemo(()=>importTimeRangeWindow(timeRange),[timeRange,fileName]);
  const sourceCategoriesEnabled=!nativeLocal&&Boolean(account.user)&&account.canLocAccessSync('scope',scopeId);
  const sourceCategories={data:sourceCategoriesEnabled?PUBLISHED_SOURCE_CATEGORIES:undefined};
  const sourceOptions=[...new Set([...(sourceCategories.data?.system||[]),...(sourceCategories.data?.personal||[])])];
  const canonicalSource=value=>canonicalImportSourceName(value,sourceCategories.data?.system||[],sourceCategories.data?.personal||[]);
  const [importLocale,setImportLocale]=useState('zh-Hant');
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  // One event-driven progress snapshot, no additional query, timer or cache.
  const [progressStore]=useState(createImportProgressStore);
  const progress=useSyncExternalStore(progressStore.subscribe,
    progressStore.getSnapshot,progressStore.getServerSnapshot);
  const setProgress=progressStore.set;
  const [summaryRefreshing,setSummaryRefreshing]=useState(false);
  const [summaryMessage,setSummaryMessage]=useState('');
  const [summaryError,setSummaryError]=useState(false);
  const [progressTick,setProgressTick]=useState(0);
  useEffect(()=>{
    if(!busy)return undefined;
    const timer=window.setInterval(()=>setProgressTick(tick=>tick+1),5000);
    return ()=>window.clearInterval(timer);
  },[busy]);
  const suggested=useMemo(()=>inferImportSourceFromFilename(fileName),[fileName]);
  const deferredSource=useDeferredValue(source);
  const analysisCurrent=deferredSource===source;
  const rawAnalysis=useMemo(()=>{
    const selected=deferredSource.trim();
    const normalized=rows.map(entry=>normalizeJsonImportEntry(entry,
      canonicalImportSourceName(archiveDetection&&selected==='Mixed'?(entry?.raw?.site||selected):selected,
        sourceCategories.data?.system||[],sourceCategories.data?.personal||[]),format.fields,t));
    return {
      valid:normalized.filter(item=>item.record).map(item=>item.record),
      normalized:normalized.filter(item=>item.record),
      mediaOnly:normalized.filter(item=>item.mediaOnlyRecord).map(item=>item.mediaOnlyRecord),
      invalid:normalized.filter(item=>item.error)
    };
  },[rows,deferredSource,format.fields,locale,archiveDetection,sourceCategories.data]);
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
  const importEstimate=useMemo(()=>{
    const attachedMedia=analyzed.normalized.reduce((count,item)=>count+(item.mediaRecords?.length||0),0);
    const media=analyzed.mediaOnly.length+attachedMedia+eligibleArchiveMediaPlan.media.length;
    return estimateImportMinutes({articles:analyzed.valid.length,media});
  },[analyzed,eligibleArchiveMediaPlan]);
  const stageEstimate=useMemo(()=>progress?.stageStartedAt
    ?estimateImportStageMinutes({completed:progress.completed,total:progress.total,
      elapsedMs:Date.now()-progress.stageStartedAt})
    :null,[progress,progressTick]);
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

  async function loadQueuedFile(file,index,total,language=importLocale,recordPath=format.recordPath){
    setFileName(file.name);setRows([]);setArchiveEvidence([]);setGeoPlaceCandidates([]);setArchiveDetection(null);setArchiveSummary(null);setProgress(null);setStatus('');
    if(file.size>ARCHIVE_MAX_BYTES){
      setStatus(t('uiExtra.importUI.zipTooLarge'));
      return;
    }
    const firstBytes=new Uint8Array(await file.slice(0,4).arrayBuffer());
    const isZip=/\.zip$/i.test(file.name)||(firstBytes[0]===80&&firstBytes[1]===75&&[3,5,7].includes(firstBytes[2]));
    const isThreadsJson=!isZip&&/\.json$/i.test(file.name)&&
      /(?:^|[-_. ])(?:threads|text_post_app_text_posts)(?:$|[-_. ])/i.test(file.name);
    const isFacebookGeoJson=!isZip&&/(?:^|\/)places_you_have_been_tagged_in\.json$/i.test(file.name);
    setBusy(true);
    if(isZip)setStatus(t('uiExtra.importUI.zipInspecting'));
    try{
      if(isZip||isThreadsJson||isFacebookGeoJson){
        // ZIP, standalone Threads posts and independent Facebook visit JSON use the scanner;
        // source names are only hints, each record must be a public post.
        const {detectZipArchiveSource,inspectPrivateArchive}=await import('./private-archive-universal.mjs');
        const result=isZip
          ?await detectZipArchiveSource(file,{skipPrivateEntries:!nativeLocal,onProgress:p=>setProgress({stage:'正在辨識 ZIP 檔案',completed:Number(p.filesSeen||0),total:0,percent:null})})
          :{kind:isFacebookGeoJson?'facebook':'threads',
            sources:[isFacebookGeoJson?'facebook':'threads'],confidence:1,
            evidence:[{source:isFacebookGeoJson?'facebook':'threads',path:file.name,verified:false}],
            structure:null,audit:null};
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
          setSource(result.sources.length===1?canonicalSource(result.sources[0]):'');
          setStatus((summary.geoPlaceObjects?'檔案已讀取，辨識出 '+summary.geoPlaceObjects.toLocaleString()+' 筆 Facebook 地點物件，僅供人工整理 Trace；沒有自動建立地點或文章。':'檔案已讀取，但沒有可匯入的文字文章。')+' 已解析 '+summary.totalRows+
            ' 筆、略過 '+(summary.rejectedRows+ignored)+' 筆。'+
            (summary.problems.length?' 原因：'+summary.problems.slice(0,3).join('；'):' 請檢查資料格式。'));
          return;
        }
        setRows(imported);
        const sourceNames=[...new Set(imported.map(item=>item.raw.site))];
        setSource(sourceNames.length===1?canonicalSource(sourceNames[0]):'Mixed');
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
      const {parseUniversalImportFile}=await import('./universal-file-import.mjs');
      const parsed=await parseUniversalImportFile(file,{recordPath,importLocale:language});
      const list=filterStandalonePublicRows(parsed,nativeLocal);
      assertStandaloneImportDestination({nativeLocal,fileName:file.name,rows:list});
      const prepared=list.map(row=>({
        raw:row,
        import_uid:createUid8()
      }));
      setRows(prepared);
      // Use the filename as the default source; Scope editors may override it.
      setSource(canonicalSource(inferImportSourceFromFilename(file.name)));
      setStatus(t('uiExtra.importUI.parsedFile',{index:index+1,total,count:list.length.toLocaleString()})+
        (parsed.length!==list.length?'；已略過 '+(parsed.length-list.length).toLocaleString()+' 筆私人紀錄。':''));
    }catch(error){
      setRows([]);setArchiveEvidence([]);
      const wasBlocked=['LOC_PRIVATE_ARCHIVE_BLOCKED','LOC_UNVERIFIED_ARCHIVE_BLOCKED'].includes(error?.code);
      setStatus(wasBlocked
        ?'第 '+(index+1)+' 檔已阻止匯入：'+String(error?.message||error)+'；本次未寫入資料庫。'
        :t('uiExtra.importUI.parseFileFailed',{index:index+1,error:error?.message||error}));
    }finally{
      setBusy(false);setProgress(null);
    }
  }
  async function chooseFile(event){
    if(busy)return;
    const files=Array.from(event.target.files||[]);
    if(!files.length)return;
    setQueue(files);setQueueIndex(0);
    await loadQueuedFile(files[0],0,files.length);
  }
  async function nextFile(){
    const next=queueIndex+1;
    if(busy||next>=queue.length)return;
    setQueueIndex(next);
    await loadQueuedFile(queue[next],next,queue.length);
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
      const visits=candidates.flatMap(place=>{
        const uid=importedPlaceId({incoming:place,byName:result.byName,byCoordinate:result.byCoordinate});
        return uid?(place.__importVisitTimes||[]).map(time=>({uid,time})):[];
      });
      const saved=await recordImportPlaceVisits(visits,{
        relation:dbAuthRelation,table:result.table,timesByUid:result.timesByUid,
        createtimeByUid:result.createtimeByUid,attrsByUid:result.attrsByUid
      });
      setStatus('獨立 Facebook 打卡已匯入：空間定錨新增 '+result.created.toLocaleString()+
        '、沿用 '+result.reused.toLocaleString()+'；日期定錨新增 '+
        dates.created.toLocaleString()+'、沿用 '+dates.reused.toLocaleString()+
        '；'+'Point 造訪時間新增 '+saved.added.toLocaleString()+
        '。沒有新增 Galaxy 文章；缺少原始座標的地點不會捏造座標。'+
        importAnchorConflictSummary(result,dates));
    }catch(error){setStatus('Trace 地點儲存失敗：'+String(error?.message||error));}
    finally{setBusy(false);setProgress(null);}
  }
  async function restoreExistingAnchors(){
    if(busy||nativeLocal||scopeId==='loc')return;
    if(!window.confirm('補齊既有文章的空間定錨、日期定錨與地點關聯，將同一 Point 的全部已知造訪時間去重彙整至 attr.times，並在 createtime 為空時補入最早來源時間；不新增或刪除文章、不覆寫既有建立時間。確定執行？'))return;
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
        result.linked.toLocaleString()+'，'+'Point 造訪時間新增 '+result.visits.toLocaleString()+
        '，未能確定地點 '+result.unmatched.toLocaleString()+' 筆。'+
        importAnchorConflictSummary(result.places,result.dates));
    }catch(error){
      setStatus('既有打卡定錨修復失敗；已完成的部分可能已寫入，重新執行會沿用既有資料。原始錯誤：'+String(error?.message||error));
    }finally{setProgress(null);setBusy(false);}
  }
  async function run(){
    if(busy||(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveEvidence.length))return;
    const selected=canonicalSource(source);
    if(!selected){setStatus(t('uiExtra.importUI.selectSource'));return;}
    if(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveEvidence.length){setStatus(t('uiExtra.importUI.noValidItems'));return;}
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
          const {data,error}=await dbAuthRelation(galaxy).select('uid').ilike('site',site).limit(1);
          if(error)throw Error('網站範圍查詢失敗：'+error.message);
          siteAvailability.set(site,Boolean(data?.length));
        }
        return siteAvailability.get(site);
      };
      const distinctSites=[...new Set(analyzed.valid.map(row=>String(row.site||'').trim()))];
      for(let index=0;index<distinctSites.length;index++){
        await siteHasArticles(distinctSites[index]);
        showProgress('確認網站既有文章',index+1,distinctSites.length);
      }
      // Deduplicate the entire imported file, not only sites populated
      // before this import. Preserve the canonical UID for media references.
      const incoming=dedupeIncomingImport(analyzed.valid);
      let unique=incoming.unique;
      let duplicateCount=incoming.duplicates;
      // The pool is this site's saved rows inside the incoming time span, which
      // already sits inside the selected import range. Only uid + createtime are
      // read for the span; full rows are read by UID for real timestamp matches.
      const readSiteSpan=async(site,start,end)=>{
        // Strict timestamp cursor: the extra boundary row detects a tied
        // timestamp split across pages. Fetch that entire tie as one group,
        // then advance to the next timestamp. UID is only an identity check.
        // Read every matched timestamp window; only the transport page is sized.
        const pageSize=999,rows=[],seenUids=new Set();
        let after=null;
        const append=page=>{
          for(const row of page){
            const uid=String(row.uid||'');
            if(!uid||seenUids.has(uid))
              throw Error('時間區間 SELECT 出現重複或無效文章 UID，已停止匯入以避免漏比對');
            seenUids.add(uid);rows.push(row);
          }
        };
        for(;;){
          let query=dbAuthRelation(galaxy).select(GALAXY_IMPORT_TIME_COLUMNS)
            .ilike('site',site).gte('createtime',start).lte('createtime',end);
          if(after!==null)query=query.gt('createtime',after);
          const {data,error}=await query.order('createtime',{ascending:true})
            .range(0,pageSize); // pageSize rows plus one timestamp probe
          if(error)throw Error('createtime 比對失敗：'+error.message);
          const found=data||[];
          if(!found.length)break;
          const page=found.slice(0,pageSize);
          const boundary=String(page[page.length-1]?.createtime||'');
          if(!boundary)throw Error('比對資料缺少建立時間，已停止匯入');
          const probe=found[pageSize];
          if(probe&&String(probe.createtime||'')===boundary){
            // Every tied row is consumed together, never split by OFFSET.
            const beforeBoundary=page.filter(row=>String(row.createtime)!==boundary);
            append(beforeBoundary);
            // Even thousands of records sharing one timestamp must all be
            // compared. The 1,000-record write batch is not a SELECT ceiling.
            const tiePageSize=1000;
            for(let tieOffset=0;;){
              const {data:tied,error:tieError}=await dbAuthRelation(galaxy)
                .select(GALAXY_IMPORT_TIME_COLUMNS)
                .ilike('site',site).eq('createtime',boundary)
                .order('uid',{ascending:true})
                .range(tieOffset,tieOffset+tiePageSize-1);
              if(tieError)throw Error('相同建立時間的文章比對失敗：'+tieError.message);
              if(!(tied||[]).length)break;
              append(tied);
              tieOffset+=tied.length;
            }
          }else append(page);
          after=boundary;
          if(found.length<=pageSize)break;
        }
        return rows;
      };
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
          for(const idsPage of urlSafeInBatches(ids,'site_id')){
            // Page every stored candidate; one platform ID can map to
            // multiple legacy rows and must remain ambiguous until compared.
            const pageSize=500;
            for(let offset=0;;){
              const {data,error}=await dbAuthRelation(galaxy)
                .select(GALAXY_IMPORT_UID_COLUMNS)
                .ilike('site',site).in('site_id',idsPage)
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
      const reservedSavedUids=new Set([...matchesById.values()].map(row=>String(row.uid)));
      // Ambiguous site IDs must not fall through into timestamp matching,
      // which could choose a different article and silently overwrite it.
      const remaining=existingCandidates.filter(row=>
        !matchesById.has(String(row.uid))&&!ambiguousByIdUids.has(String(row.uid)));
      const existingByTime=remaining.length?await matchExistingImportByCreatedAt(remaining,{
        onProgress:p=>showProgress('依網站與發文時間比對',p.completed,p.total),
        readTimestamps:(times,consumePage,site,report)=>readImportCandidatesByTimeWindows(times,{
          readWindow:(start,end)=>readSiteSpan(site,start,end),
          readRowsByUid,consumePage,excludeUids:reservedSavedUids,
          windowSize:1000,concurrency:times.length>=3000?3:1,onWindowDone:report
        })
      }):new Map();
      const existingBySiteId=new Map([...existingByTime,...matchesById]);
      // A same-site/same-createtime group that can't be matched to exactly one
      // existing article is never inserted as new (that risks the duplicate
      // this comparison exists to catch) and never allowed to abort the rest
      // of the batch — it is excluded from this run and reported for manual
      // review instead.
      const ambiguousByTime=existingByTime.ambiguous||[];
      const ambiguousGroups=[...ambiguousById,...ambiguousByTime];
      if(ambiguousGroups.length){
        const ambiguousUids=new Set(ambiguousGroups.map(group=>group.uid));
        unique=unique.filter(record=>!ambiguousUids.has(String(record.uid)));
      }

      const finalUid=id=>{
        const canonical=incoming.aliases.get(String(id))||String(id);
        return String(existingBySiteId.get(canonical)?.uid||canonical);
      };
      unique=unique.map(record=>({
        ...record,
        source_id:record.source_id?finalUid(record.source_id):null,
        target_id:(record.target_id||[]).map(finalUid)
      }));
      // Articles with check-ins still need a spatial/date backfill on repeat imports.
      if(isUnchangedImportBeforeWrite(unique,existingBySiteId,{
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
        setRows([]);
        setArchiveEvidence([]);
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
      // Only an article with a location may contribute its date to Time anchors.
      const checkinAnchorRecords=anchorRecords.filter(record=>
        Boolean(String(record.location||record.__importPlaceName||'').trim()));
      const anchorSnapshot=!nativeLocal&&scopeId!=='loc'&&
        (checkinAnchorRecords.length||geoAnchorRecords.length)
        ?await readImportPointDateAnchors({scopeId,
          onProgress:p=>showProgress(p.phase,p.completed,p.total||0)})
        :null;
      const placeAnchors=await prepareImportPlaceAnchors([...anchorRecords,...geoAnchorRecords],{
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
      const placeVisits=[];
      const updateSizer=createImportBatchSizer();
      let updateQueue=[];
      const existingCount=existingBySiteId.size;
      if(existingCount)showProgress('更新既有文章',0,existingCount);
      const flushUpdates=async()=>{
        if(!updateQueue.length)return;
        const count=updateQueue.length,started=Date.now();
        const result=await updateImportRows(galaxy,updateQueue);
        updated+=result.count;
        updateQueue=[];
        updateSizer.observe(count,Date.now()-started);
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
        if(!String(existing.ref_id||'').trim()&&String(record.ref_id||'').trim())changes.ref_id=record.ref_id;
        if(!String(existing.source_id||'').trim()&&String(record.source_id||'').trim())changes.source_id=record.source_id;
        if(!(Array.isArray(existing.target_id)&&existing.target_id.length)&&record.target_id?.length)
          changes.target_id=record.target_id;
        const placeRecord=placeRecordByUid.get(String(record.uid))||record;
        const restoredPlace=importedPlaceId({incoming:placeRecord,existing,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
        if(restoredPlace)changes.place_id=restoredPlace;
        const matchedPlace=importedPlaceId({incoming:placeRecord,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
        const visitUid=restoredPlace||(
          matchedPlace===String(existing.place_id||'').trim()?matchedPlace:null);
        if(visitUid&&record.createtime)placeVisits.push({uid:visitUid,time:record.createtime});
        if(Object.keys(changes).length){
          updateQueue.push({uid:String(existing.uid),...changes});
          if(updateQueue.length>=updateSizer.size)await flushUpdates();
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
      let payload=[],newArticleProcessed=0;
      const newArticleVisits=[];
      const flushNewArticles=async()=>{
        if(!payload.length)return;
        const count=payload.length,started=Date.now();
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
        payload=[];
        insertSizer.observe(count,Date.now()-started);
        showProgress('新增文章',newArticleProcessed,newArticleTotal);
      };
      for(const record of unique){
        if(existingBySiteId.has(record.uid))continue;
        const placeUid=importedPlaceId({incoming:record,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
        const {__importCoordinates:unusedCoordinates,
          __importPlaceName:unusedPlaceName,__importPlaceAddress:unusedPlaceAddress,
          __importPlaceUrl:unusedPlaceUrl,__importCheckin:unusedCheckin,
          ...article}=record;
        if(placeUid)newArticleVisits.push({articleUid:String(record.uid),uid:placeUid,time:record.createtime});
        payload.push(placeUid?{...article,place_id:placeUid}:article);
        if(payload.length>=insertSizer.size)await flushNewArticles();
      }
      await flushNewArticles();
      const savedVisits=[
        ...placeVisits,
        ...newArticleVisits.filter(visit=>result.insertedUids.has(visit.articleUid)),
        ...geoAnchorRecords.flatMap(place=>{
          const uid=importedPlaceId({incoming:place,byName:placeAnchors.byName,byCoordinate:placeAnchors.byCoordinate});
          return uid?(place.__importVisitTimes||[]).map(time=>({uid,time})):[];
        })
      ];
      let recordedVisits=0;
      if(savedVisits.length){
        showProgress('核對 Point 造訪時間');
        const visitResult=await recordImportPlaceVisits(savedVisits,{
          relation:dbAuthRelation,table:placeAnchors.table,timesByUid:placeAnchors.timesByUid,
          createtimeByUid:placeAnchors.createtimeByUid,attrsByUid:placeAnchors.attrsByUid
        });
        recordedVisits=visitResult.added;
      }
      duplicateCount+=result.conflicts;
      for(const uid of result.insertedUids)knownArticleIds.set(uid,uid);
      for(const record of analyzed.valid){
        const canonical=incoming.aliases.get(record.uid)||record.uid;
        const savedUid=knownArticleIds.get(canonical);
        if(savedUid)knownArticleIds.set(record.uid,savedUid);
      }
      showProgress('整理媒體資料');
      const articleTimes=new Map(analyzed.valid.map(row=>[String(row.uid),row.createtime]));
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
      const mediaSummary=await syncImportedMedia({
        normalized:analyzed.normalized,
        mediaOnly:[...safeMediaOnly,...canonicalArchiveMedia],
        extraLinks:archivePlan.mediaLinks,
        knownArticleIds,scopeId,galaxy,mediaAnchor,t,
        onProgress:p=>showProgress(p.stage,p.completed,p.total||0)
      });
      // All article and media writes are finished: now recompute the
      // persisted Search summary once. A summary error must not turn a
      // successful import into a retry-all error.
      if(!nativeLocal)await refreshImportedSearchSummary();
      const skipped=analyzed.invalid.length+analyzed.skippedByRange+
        duplicateCount+ambiguousGroups.length;
      showProgress('匯入完成',1,1);
      setStatus(t('uiExtra.importUI.importLinkedComplete',{articles:result.inserted,media:mediaSummary.created,linked:mediaSummary.connected,skipped})+
        (result.conflicts?'；UID 衝突未建立文章／媒體關聯 '+result.conflicts.toLocaleString()+' 筆。':'')+
        '；已更新既有文章 '+updated.toLocaleString()+' 筆，沿用空間定錨點 '+placeAnchors.reused.toLocaleString()+' 筆，新增空間定錨點 '+placeAnchors.created.toLocaleString()+' 筆，新增日期定錨 '+timeAnchors.created.toLocaleString()+' 筆，沿用日期定錨 '+timeAnchors.reused.toLocaleString()+' 筆，'+'Point 造訪時間新增 '+recordedVisits.toLocaleString()+' 筆，未匹配地點 '+placeAnchors.unmatchedCoordinates.toLocaleString()+' 組。'+importAnchorConflictSummary(placeAnchors,timeAnchors,mediaSummary)+
        (ambiguousGroups.length?'；來源文章 ID 或發文時間對應多篇既有文章，無法唯一比對而暫不匯入 '+
          ambiguousGroups.length.toLocaleString()+' 筆（其他文章繼續處理）。待確認：'+
          ambiguousGroups.slice(0,5).map(group=>'UID '+String(group.uid)+' / '+
            group.site+' / '+(group.site_id||group.createtime)+
            (group.saved_uids?.length?'，候選 UID '+group.saved_uids.slice(0,5).join(',')+
              (group.saved_uids.length>5?'…':''):'')).join('、')+
            (ambiguousGroups.length>5?' 等':'')+'。':''));
      setRows([]);setArchiveEvidence([]);setGeoPlaceCandidates([]);
      if(nativeLocal)window.dispatchEvent(new Event('loc-local-data-changed'));
    }catch(error){
      setProgress(null);
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
    if(queue.length)await loadQueuedFile(queue[queueIndex],queueIndex,queue.length,next);
  }
  function changeImportFormat(next){
    if(busy)return;
    onFormatChange(next);
    // A changed record path changes the parsed file, not just field mapping.
    // Reparse the queued file in place instead of resetting the whole import.
    if(next.recordPath!==format.recordPath&&queue.length)
      void loadQueuedFile(queue[queueIndex],queueIndex,queue.length,importLocale,next.recordPath);
  }
  const pending=queue.length>queueIndex+1;
  return <div className="scope-import-body">
    <div className="scope-import-primary-row">
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
    <label className="scope-import-source-choice"><UiText id="uiExtra.importUI.sourceLabel"/>
      <input type="text" list={'scope-import-sources-'+scopeId} maxLength={80} required
        value={source} onChange={event=>setSource(event.target.value)}
        disabled={busy||!rows.length} placeholder={suggested}/>
      <datalist id={'scope-import-sources-'+scopeId}>
        {sourceOptions.map(name=><option key={name} value={name}/>)}
      </datalist>
    </label>
    <label className="scope-import-source-choice">匯入時間範圍
      <select value={timeRange} disabled={busy} onChange={event=>setTimeRange(event.target.value)}>
        <option value="all">全部的時間</option>
        <option value="year">近一年（預設）</option>
        <option value="halfYear">近半年</option>
        <option value="month">近一月</option>
      </select>
      <small className="scope-import-range-hint">{timeWindow?timeWindow.start.slice(0,10)+' 至 '+timeWindow.end.slice(0,10):'不限日期'}</small>
    </label>
    </div>
    <ImportFormatSettings format={format} onChange={changeImportFormat} disabled={busy}/>
    {fileName?<p><UiText id="uiExtra.importUI.fileLabel"/><strong>{fileName}</strong><UiText id="uiExtra.importUI.fileQueue" params={{index:queueIndex+1,total:queue.length}}/><strong>{archiveDetection?(archiveDetection.sources.map(kind=>ZIP_SOURCE_NAMES[kind]||kind).join(' / ')||t('uiExtra.importUI.zipUnknown')):source||suggested}</strong></p>:null}
    {rows.length||eligibleArchiveMediaPlan.media.length?<section className="scope-import-save" aria-label={t('uiExtra.importUI.saveSection')}>
      <button type="button" className="loc-button primary scope-import-save-button"
        disabled={busy||!analysisCurrent||(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveMediaPlan.media.length)} onClick={run}>
        {busy?UI_COPY.management.importing:t('uiExtra.importUI.batchImport')}
      </button>
      <div className="scope-import-save-summary">
        {!busy&&analysisCurrent?<p className="scope-import-ready-counts">{t('uiExtra.importUI.importReadyCounts',{articles:analyzed.valid.length.toLocaleString(),media:(analyzed.mediaOnly.length+eligibleArchiveMediaPlan.media.length).toLocaleString()})}</p>:null}
        {!busy&&analysisCurrent&&importEstimate?<p className="scope-status">{t('uiExtra.importUI.importEstimatedMinutes',importEstimate)}</p>:null}
      </div>
    </section>:null}
    {rows.length&&!busy&&!analysisCurrent?<p className="scope-status" role="status">正在更新匯入資料預覽，完成後才能開始匯入。</p>:null}
    {rows.length&&!busy&&analysisCurrent&&!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveMediaPlan.media.length?<p className="scope-status" role="status">目前沒有可匯入的有效紀錄，請查看上方略過原因。</p>:null}
    {busy&&!progress?<p role="status" className="scope-status"><ActivityMotion kind="import"/> 正在處理匯入資料…</p>:null}
    {progress?<div role="status" aria-live="polite" aria-atomic="true" className="scope-import-progress">
      {busy?<p className="scope-status"><ActivityMotion kind="import"/> <strong>{t('uiExtra.importUI.importProcessingWait')}</strong></p>:null}
      <p><strong>{progress.stage}</strong></p>
      {progress.percent===null?<progress max="100" aria-label={progress.stage+'，處理中'}/>:
        <progress value={progress.percent} max="100" aria-label={progress.stage+'，已完成 '+progress.percent+'%'}/>}
      {progress.total>0?<p className="scope-status">已處理 {Number(progress.completed).toLocaleString()} / {Number(progress.total).toLocaleString()}（{progress.percent}%）</p>:
        <p className="scope-status">已處理 {Number(progress.completed||0).toLocaleString()} 項{progress.detail?'；'+progress.detail:'；總量仍在確認'}。</p>}
      {progress.total>0&&progress.detail?<p className="scope-status">{progress.detail}</p>:null}
      {stageEstimate?<p className="scope-import-stage-estimate">{stageEstimate.underMinute
        ?t('uiExtra.importUI.importStageLessThanMinute')
        :t('uiExtra.importUI.importStageRemainingMinutes',{minutes:stageEstimate.minutes})}</p>:null}
    </div>:null}
    {/* Rendered right under the import button/progress area, not after every
        intermediate ZIP/archive detail section below — the user is watching
        here, and a result (success, "no changes", or an error like the
        ambiguous-duplicate abort) buried past a long ZIP summary goes unseen. */}
    {status&&(!busy||!progress)?<p className="scope-status scope-import-live-status" role="status">{status}</p>:null}
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
        <p className="scope-status">已匯入文章若有地點，可補齊空間與日期定錨、文章地點關聯，依 place_id 彙整不同 location 的造訪時間至 Point.attr.times（去重排序），並補齊缺少的 createtime。原始文章仍保留在 Galaxy；不新增文章或覆寫既有 Point 建立時間。</p>
        <button type="button" className="loc-button" disabled={busy} onClick={restoreExistingAnchors}>
          {busy?'正在檢查地點關聯…':'補齊既有文章的地點與日期定錨'}
        </button>
      </div>
    </details>:null}
    {archiveDetection?<section className="scope-import-preview" aria-label={t('uiExtra.importUI.zipDetected')}>
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
    </section>:null}
    {archiveDetection?.fileInventory?<p className="scope-status" role="status">
      ZIP 完整清點：{archiveDetection.fileInventory.allFiles.toLocaleString()} 個檔案，其中 JSON {archiveDetection.fileInventory.jsonFiles.toLocaleString()} 個（私人對話候選 JSON {archiveDetection.fileInventory.privateJsonFiles.toLocaleString()} 個）。前面的資料結構辨識是抽樣，不代表只掃描這些檔案。
    </p>:null}
    {archiveSummary?<p className="scope-status" role="status">
      JSON 核對：共 {archiveSummary.jsonFilesSeen.toLocaleString()} 個；完成解析 {archiveSummary.jsonFilesParsed.toLocaleString()}、私人對話排除 {archiveSummary.jsonFilesPrivate.toLocaleString()}、格式未辨識 {archiveSummary.jsonFilesUnrecognized.toLocaleString()}、檔案過大 {archiveSummary.jsonFilesOversize.toLocaleString()}、其他不支援 {archiveSummary.jsonFilesUnsupported.toLocaleString()}。
      {archiveDetection?.fileInventory&&archiveDetection.fileInventory.jsonFiles!==archiveSummary.jsonFilesSeen?' ZIP 清點與解析掃描的 JSON 總數不一致，請先核對來源檔案。':''}
      {archiveSummary.jsonFilesSeen!==archiveSummary.jsonFilesParsed+archiveSummary.jsonFilesPrivate+archiveSummary.jsonFilesUnrecognized+archiveSummary.jsonFilesOversize+archiveSummary.jsonFilesUnsupported?' JSON 數量尚未完全對帳，請勿視為完整匯入。':''}
      原始紀錄 {archiveSummary.totalRows.toLocaleString()} 筆，解析接受 {archiveSummary.acceptedRows.toLocaleString()} 筆，解析拒絕 {archiveSummary.rejectedRows.toLocaleString()} 筆；解析接受不等於最終寫入成功。
    </p>:null}
    {archiveSummary?.urlAudit?<p className="scope-status" role="status">
      原始 JSON 巢狀 url 屬性核對：總計 {archiveSummary.urlAudit.total.toLocaleString()} 個；
      文章候選 {archiveSummary.urlAudit.article.toLocaleString()}、媒體／附件 {archiveSummary.urlAudit.media.toLocaleString()}、
      地點 {archiveSummary.urlAudit.place.toLocaleString()}、其他 {archiveSummary.urlAudit.other.toLocaleString()}。
      這是來源欄位出現次數，不等於已保存的公開 URL。
      {archiveSummary.urlAudit.truncated?' 有 '+archiveSummary.urlAudit.truncated.toLocaleString()+' 筆超過掃描上限；數量為下限。':''}
    </p>:null}
    {archiveSummary?<p className="scope-status" role="status">文章原始網址 {Number(archiveSummary.articleWithUrl||0).toLocaleString()}／{rows.length.toLocaleString()} 篇；未取得網址的文章不會以 ZIP uri、媒體連結或來源 ID 偽造文章 URL。</p>:null}
    {archiveSummary?<p className="scope-status" role="status">已清點 {archiveSummary.mediaFiles.toLocaleString()} 個 ZIP 媒體檔；符合文章關聯的媒體候選 {archiveSummary.mediaImportable.toLocaleString()} 筆（有公開網址 {archiveSummary.mediaWithUrl.toLocaleString()} 筆、無公開網址但已確認 ZIP 檔案 {archiveSummary.mediaZipLinked.toLocaleString()} 筆），未匹配或不支援的 ZIP 媒體約 {archiveSummary.mediaZipNotLinked.toLocaleString()} 筆。依目前時間範圍可建立 {eligibleArchiveMediaPlan.media.length.toLocaleString()} 筆媒體紀錄。僅 ZIP 附件會建立 UID 及文章 media_link，URL 保留空值；不會上傳圖片或影片檔案，也不會用 ZIP 路徑冒充播放網址。</p>:null}
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
     {rows.length?<section className="scope-import-preview" aria-label={t('uiExtra.importUI.preview')}>
      <p className="scope-status"><UiText id="uiExtra.importUI.validSkipped" params={{valid:analyzed.valid.length.toLocaleString(),skipped:analyzed.invalid.length.toLocaleString()}}/> 此處為檔案解析結果，不代表本次會新增相同篇數；每次選取檔案都會重新解析，實際新增／更新／略過請以資料庫比對後的匯入結果為準。</p>
      {unidentifiedUndatedCount>0?<p className="scope-status" role="status">
        有 {unidentifiedUndatedCount.toLocaleString()} 筆同時缺少來源文章 ID 與原始發文時間。無法以目前的來源 ID／時間比對保證重匯去重；即使檔名相同也可能再次新增，請核對來源資料。
      </p>:null}
      <div className="scope-management-records">
        {analyzed.valid.slice(0,5).map(record=><article className="loc-bubble" key={record.uid}>
          <strong><LinkedImportText text={record.title||record.uid}/></strong>
          <span>{record.uid} · {String(record.createtime||'').slice(0,10)||t('uiExtra.importUI.noDate')}</span>
          <p><LinkedImportText text={record.content} limit={180}/></p>
        </article>)}
      </div>
      {analyzed.invalid.length?<p className="scope-status"><UiText id="uiExtra.importUI.skippedReasons"/>{analyzed.invalid.slice(0,5).map(item=>item.error).join('、')}</p>:null}
    </section>:null}
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
