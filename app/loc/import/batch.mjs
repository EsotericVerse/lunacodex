// One format contract for JSON Import and Source Refresh. No database authority lives here.
// Archive size limits are configuration, not proof of successful large-file import E2E.
import {MAX_ROWS,HEAVY_INITIAL_ROWS,HEAVY_QUERY_ROWS,IMPORT_WRITE_TARGET_BYTES,createTextAdaptiveRows,MAX_ARCHIVE_BYTES,MAX_JSON_BYTES} from '../query/query-batch-size.mjs';
import {unwrapArchiveArrayRows} from '../archive/array-layout.mjs';
import {runeDrawText} from './rune-draw-text.mjs';
import {sourceImportModel} from '../../../packages/zenstack/import-source-models.mjs';
// Lightweight file-selection contracts remain separate from parser implementations.
export const UNIVERSAL_IMPORT_ACCEPT='.zip,.json,.md';
export {MAX_ARCHIVE_BYTES as ARCHIVE_MAX_BYTES,MAX_JSON_BYTES as ARCHIVE_JSON_MAX_BYTES};
export const IMPORT_FIELD_ALIASES=Object.freeze({
  uid:['uid'],
  site_id:['site_id','post_id','id_str'],
  content:['content','body','text','message','description'],
  title:['title','name','subject'],
  createtime:['createtime','created_at','create_time','created_time','creation_timestamp','timestamp_ms','timestamp','taken_at','createdAt','createAt','published_at','publishedAt','date'],
  location:['location','place'],
  url:['url'],
  media_link:['media_link'],
  media:['galaxy_media','attachments','media','media_items'],
  media_type:['media_type'],
  galaxy_link:['galaxy_link'],
  description:['description'],
  rune_references:['rune_references'],
  source_id:['source_id'],
  target_id:['target_id'],
  ref_id:['ref_id'],
  searchable:['searchable','search'],
  statistics_able:['statistics_able','statistics']
});


const IMPORT_MEDIA_UID=/^[A-Z0-9]{8}$/i;
function importMediaType(url='',hint=''){
  const type=String(hint||'').trim().toLowerCase();
  if(type)return type;
  const value=String(url||'').toLowerCase();
  if(value.includes('suno.com/'))return 'suno';
  if(/\.(?:png|jpe?g|gif|webp|heic|avif|svg)(?:[?#]|$)/.test(value))return 'image';
  if(/\.(?:mp4|mov|avi|webm|mkv)(?:[?#]|$)/.test(value))return 'video';
  if(/\.(?:mp3|wav|ogg|m4a|flac)(?:[?#]|$)/.test(value))return 'audio';
  return 'url';
}
function parseMediaArray(value){
  if(Array.isArray(value))return value;
  if(value===undefined||value===null||value==='')return [];
  if(typeof value==='object')return [value];
  const text=String(value).trim();
  if(text.startsWith('[')||text.startsWith('{')){
    try{return parseMediaArray(JSON.parse(text))}catch{throw new Error('媒體欄位不是有效的 JSON。')}
  }
  return text.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean);
}
// Preserve references to existing media IDs; prepare new media records without inventing
// accessible URLs for archive-local attachment paths.
export function normalizeImportMedia(value,{title='',createtime=null,location='',article_uid='',defaultMediaType=''}={}){
  const references=[],records=[],seen=new Set();
  for(const [index,item] of parseMediaArray(value).entries()){
    const source=typeof item==='string'?{url:item}:item;
    if(!source||typeof source!=='object')continue;
    const explicitId=String(source.uid||'').trim();
    const rawUrl=String(source.media_url||source.mediaUrl||source.image_url||source.video_url||source.download_url||source.downloadUrl||source.source_url||source.thumbnail_url||
      source.external?.url||source.file?.url||source.image?.url||
      source.url||source.uri||source.href||source.link||'').trim();
    if(explicitId&&!IMPORT_MEDIA_UID.test(explicitId))throw new Error('媒體 uid 必須為 8 碼英數字。');
    if((typeof item==='string'&&IMPORT_MEDIA_UID.test(item))||(explicitId&&!rawUrl&&!source.media_type&&!source.type&&!source.title&&!source.name&&!source.description)){
      references.push(typeof item==='string'?item:explicitId);
      continue;
    }
    const external=/^https?:\/\//i.test(rawUrl)?rawUrl:null;
    if(!external&&!rawUrl&&!source.media_type&&!source.type&&!source.mime_type&&!source.title&&!source.name&&!source.description&&source.rune_references==null)continue;
    const hint=String(source.type||'').toLowerCase();
    const media_type=importMediaType(rawUrl,source.media_type||
      (hint==='external'||hint==='file'?'':source.type)||
      defaultMediaType||source.mime_type||
      (source.image_url?'image':source.video_url?'video':source.rune_references!=null?'runes':''));
    const record={
      ...(explicitId?{uid:explicitId}:{}),
      __article_uid:article_uid||null,
      location:String(source.location||'').trim()||null,
      media_type,
      title:String(source.title||source.name||title||'').trim()||null,
      url:external,
      description:(()=>{
        const description=source.description;
        if(description===undefined||description===null)return null;
        const normalized=['rune','runes'].includes(media_type)
          ?runeDrawText(description)
          :(typeof description==='string'?description.trim():JSON.stringify(description));
        return normalized||null;
      })(),
      // Article-led LOC: media Anchor creation reference follows the source
      // article's exact createtime. A media-only import uses its own stamp.
      createtime:parseImportCreatedTime(createtime)||
        parseImportCreatedTime(source.createtime??source.created_at??
          source.creation_timestamp??source.taken_at??source.timestamp)||null
    };
    if(source.rune_references!==undefined)record.rune_references=source.rune_references;
    const key=explicitId?'id:'+explicitId:(external?JSON.stringify([external,media_type]):'item:'+index);
    if(!seen.has(key)){seen.add(key);records.push(record);}
  }
  return {references:[...new Set(references)],records};
}

function pathValue(row,path){
  // Accept dotted and Meta bracket paths without evaluating expressions.
  const normalized=String(path||'').trim()
    .replace(/\[\s*["']([a-zA-Z_][\w-]*)["']\s*\]/g,'.$1')
    .replace(/\[\s*(\d+)\s*\]/g,'.$1');
  if(/[\[\]]/.test(normalized))return undefined;
  const segments=normalized.split('.').filter(Boolean);
  if(!segments.length)return undefined;
  if(!segments.includes('*'))return segments.reduce((value,segment)=>{
    if(value===null||value===undefined||typeof value!=='object')return undefined;
    return Object.prototype.hasOwnProperty.call(value,segment)?value[segment]:undefined;
  },row);
  // An explicit array wildcard is a bounded projection, NOT recursive
  // discovery. It preserves every Notion rich-text span in source order.
  let values=[row];
  for(const segment of segments){
    const next=[];
    for(const value of values){
      if(segment==='*'&&Array.isArray(value))next.push(...value);
      else if(value&&typeof value==='object'&&Object.hasOwn(value,segment))
        next.push(value[segment]);
      if(next.length>2048)throw new Error('來源陣列欄位超過 2048 筆，請縮小資料路徑。');
    }
    values=next;
    if(!values.length)return undefined;
  }
  return values;
}

export function mappedImportValue(row,field,fieldMap={},source=''){
  const custom=String(fieldMap?.[field]||'').trim();
  const profile=source&&typeof source==='object'&&source.fields?
    source:sourceImportModel(source,row);
  // A selected source ZModel owns its declared fields. Falling through to
  // unrelated generic Galaxy aliases could silently interpret another CMS's
  // title/content/ID as this platform's data. Generic aliases belong only to
  // custom imports and fields not declared by the selected source model.
  // A native LOC site_id remains an explicit final path for reimported rows.
  const declared=profile?.fields[field];
  const paths=custom?custom.split(/[\n,，]/g).map(value=>value.trim()).filter(Boolean):
    declared?.length?[...declared,...(field==='site_id'?['site_id']:[])]:
      (IMPORT_FIELD_ALIASES[field]||[]);
  for(const key of paths){
    let value=pathValue(row,key);
    if(Array.isArray(value)&&['content','title'].includes(field)&&
        value.every(part=>typeof part==='string'))value=value.join('');
    if(value===undefined||value===null||(typeof value==='string'&&!value.trim()))continue;
    // Do not turn REST structured fields into literal "[object Object]" text,
    // IDs or dates. Operators may still import structured media separately.
    if(['content','title','site_id','createtime','url'].includes(field)&&
        typeof value==='object')continue;
    return value;
  }
  return '';
}

// One source-model-directed record selection boundary for standalone JSON.
// Explicit operator path wins. Ambiguous collections fail visibly instead of
// choosing the first generic key (e.g. metadata.data instead of posts).
// Exact, one-level joins declared by the selected ZModel. Keep WordPress
// duplicate meta_key rows intact, and append only direct Notion page blocks.
// Do not recursively traverse CMS trees or create any SQL relation.
function projectImportSourceRelations(rows,payload,source=''){
  const profile=sourceImportModel(source);
  if(!profile?.relations?.length||!payload||typeof payload!=='object')
    return rows;
  const validId=value=>(typeof value==='string'||typeof value==='number')
    ?String(value).trim():'';
  const joins=profile.relations.flatMap(rule=>{
    const related=Array.isArray(payload)?payload:
      [rule.collection,...(rule.fallbackCollections||[])]
        .map(key=>payload[key]).find(Array.isArray);
    if(!Array.isArray(related))return [];
    const byParent=new Map();
    for(const child of related){
      if(!child||typeof child!=='object'||Array.isArray(child))continue;
      const key=validId(pathValue(child,rule.foreignKey));
      if(!key)continue;
      if(!byParent.has(key))byParent.set(key,[]);
      byParent.get(key).push(child);
    }
    return [{rule,byParent}];
  });
  if(!joins.length)return rows;
  const consumedChildren=new Set();
  const projectedRows=rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))return row;
    let projected=row;
    for(const {rule,byParent} of joins){
      const key=validId(pathValue(row,rule.primaryKey));
      const children=key?byParent.get(key):null;
      if(!children?.length)continue;
      if(rule.omitMatchedChildren)
        for(const child of children)if(child!==row)consumedChildren.add(child);
      if(rule.mode==='attach'){
        const original=projected[rule.target];
        // A source-native object is already authoritative; don't overwrite it.
        if(original!=null&&!Array.isArray(original))continue;
        projected={...projected,[rule.target]:[
          ...(Array.isArray(original)?original:[]),...children]};
      }else if(rule.mode==='append-text'){
        const parts=children.map(child=>mappedImportValue(child,rule.field,{},profile))
          .filter(value=>typeof value==='string'&&value.trim());
        if(!parts.length)continue;
        const previous=typeof projected[rule.target]==='string'?
          projected[rule.target].trim():'';
        projected={...projected,[rule.target]:[previous,...parts].filter(Boolean).join('\n\n')};
      }else if(rule.mode==='collect-media'){
        const candidates=children.flatMap(child=>{
          const kind=String(pathValue(child,rule.typeField)||'').trim();
          if(rule.allowedTypes&&!rule.allowedTypes.includes(kind))return [];
          const raw=mappedImportValue(child,rule.field,{},profile);
          const items=Array.isArray(raw)?raw:[raw];
          return items.flatMap(item=>{
            if(!item)return [];
            if(typeof item==='string')return [{url:item,media_type:kind}];
            if(typeof item==='object'&&!Array.isArray(item))
              return [{...item,media_type:kind}];
            return [];
          });
        });
        if(!candidates.length)continue;
        const existing=projected[rule.target];
        projected={...projected,[rule.target]:[
          ...(Array.isArray(existing)?existing:existing?[existing]:[]),...candidates]};
      }
    }
    return projected;
  });
  return consumedChildren.size?projectedRows.filter((_,index)=>
    !consumedChildren.has(rows[index])):projectedRows;
}

export function importRowsFromJson(payload,recordPath='',source=''){
  const selected=String(recordPath||'').trim();
  const container=selected?pathValue(payload,selected):payload;
  if(selected&&container===undefined)throw new Error('找不到資料陣列路徑：'+selected);
  if(Array.isArray(container))return projectImportSourceRelations(
    unwrapArchiveArrayRows(container),payload,source);
  if(container&&typeof container==='object'){
    if(selected)return [container];
    // A singular CMS post can contain its own media/data arrays. Never
    // promote those arrays to article rows just because they are called data.
    const strongRowKeys=['post_content','post_title','message_body','object_type',
      'properties','paragraph','contentText','message_id','item_id','dm_id',
      'session_id','caption','threadsPostId','fbPostId','igMediaId'];
    if(strongRowKeys.some(key=>Object.hasOwn(container,key)))return [container];

    const profile=sourceImportModel(source);
    const generic=['items','posts','data','records','results','blocks','pages',
      'messages','wp_posts','status_updates','your_posts',
      'text_post_app_text_posts','threads_posts','thread_posts',
      'threads_and_replies','array'];
    const roots=profile?.recordPaths?.length?profile.recordPaths:generic;
    const relationRoots=new Set(profile?.relations?.map(rule=>rule.collection)||[]);
    const populatedPrimary=roots.filter(key=>Array.isArray(container[key])&&
      !relationRoots.has(key));
    const candidates=roots.filter(key=>Array.isArray(container[key])&&
      (!relationRoots.has(key)||!populatedPrimary.length));
    const populated=candidates.filter(key=>container[key].length>0);
    const matches=populated.length?populated:candidates;
    if(matches.length>1)
      throw new Error('找到多個資料陣列（'+matches.join('、')+
        '）；請在進階格式設定選擇資料路徑，避免匯入錯誤內容。');
    if(matches.length===1)return projectImportSourceRelations(
      unwrapArchiveArrayRows(container[matches[0]]),payload,source);
    // Generic title/description fields can also describe an export envelope.
    // They only identify a standalone row after collection roots are excluded.
    if(['content','body','text','message','description','title','uid']
      .some(key=>Object.hasOwn(container,key)))return [container];

    // Retain the existing one-property Meta array envelope, without
    // recursively walking unrelated CMS blocks or nested post contents.
    if(container.array&&typeof container.array==='object'&&
        !Array.isArray(container.array)&&Object.keys(container).length===1)
      return importRowsFromJson(container.array,'',source);
  }
  throw new Error('找不到所選來源可匯入的資料列；請核對來源或在進階格式指定資料路徑。');
}

// Preserve the original timestamp when available. Unix seconds and milliseconds
// must not be confused; missing timestamps are resolved at the final import boundary.
export function parseImportCreatedTime(value){
  if(value===undefined||value===null||value==='')return null;
  const raw=typeof value==='string'?value.trim():value;
  if(raw==='')return null;
  const numeric=typeof raw==='number'?raw:
    typeof raw==='string'&&/^\d{10,13}$/.test(raw)?Number(raw):null;
  const timestamp=numeric===null?raw:
    Math.abs(numeric)<1e11?numeric*1000:numeric;
  const parsed=new Date(timestamp);
  if(Number.isNaN(parsed.getTime()))return null;
  const iso=parsed.toISOString();
  // Source exports may already carry true microsecond precision. The JS
  // Date object loses digits 4–6, but timestamptz(6) can retain them.
  const fraction=typeof raw==='string'?
    raw.match(/T\d{2}:\d{2}:\d{2}\.(\d{4,6})(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]:null;
  return fraction?iso.slice(0,19)+'.'+fraction.padEnd(6,'0')+'Z':iso;
}
// Only a missing authored creation timestamp may fall back to source update
// metadata. Never replace a genuine creation time with a later edit time.
const IMPORT_UPDATE_TIME_KEYS=Object.freeze([
  'UpdateTime','update_time','updated_time','updated_at','updatedAt',
  'modified_at','modifiedAt','post_modified_gmt','post_modified',
  'last_edited_time','edited_at','editedAt','lastModified'
]);
export function extractImportUpdatedAt(row){
  if(!row||typeof row!=='object')return null;
  for(const key of IMPORT_UPDATE_TIME_KEYS){
    const value=row[key];
    if(value===null||value===undefined||value==='')continue;
    const parsed=parseImportCreatedTime(value);
    if(parsed)return parsed;
  }
  return null;
}

// An absent original timestamp is null, never the import clock.
const IMPORT_TIME_KEYS=['createtime','createdAt','createAt','created_at','creation_timestamp','create_time',
  'created_time','timestamp_ms','timestamp','taken_at','published_at','publishedAt','date'];
const IMPORT_TIME_WRAPPERS=['media','data','array','attachments','string_map_data','label_values','core','post','metadata'];
export function extractImportCreatedAt(value,depth=0){
  if(!value||typeof value!=='object'||depth>5)return null;
  if(Array.isArray(value)){
    for(const part of value.slice(0,128)){
      const t=extractImportCreatedAt(part,depth+1);
      if(t)return t;
    }
    return null;
  }
  for(const key of IMPORT_TIME_KEYS){
    const part=value[key];
    if(part==null)continue;
    const t=parseImportCreatedTime(part);
    if(t)return t;
    if(typeof part==='object'){
      const nested=extractImportCreatedAt(part,depth+1);
      if(nested)return nested;
    }
  }
  for(const key of IMPORT_TIME_WRAPPERS){
    if(value[key]&&typeof value[key]==='object'){
      const nested=extractImportCreatedAt(value[key],depth+1);
      if(nested)return nested;
    }
  }
  return null;
}
// Imported rows are sized by the text actually present, not row count alone.
// The existing Native managed-write request envelope is 700 KB; this smaller
// transport payload target leaves room for the operation's JSON wrapper and
// ZModel normalization. 10k rows is only a ceiling, not a forced SQL LIMIT.
export const IMPORT_PAYLOAD_TARGET_BYTES=IMPORT_WRITE_TARGET_BYTES;
// A checkpoint is a receipt for CONFIRMED batches, never a forced 8192-row
// SQL request or permission to skip live UID comparison on retry.
export const IMPORT_FIRST_BATCH_ROWS=256;
export const IMPORT_FIRST_CHECKPOINT_ROWS=4096;
export const IMPORT_MAX_CHECKPOINT_ROWS=8192;
const importRowJson=row=>JSON.stringify(row);
const importRowBytes=row=>new TextEncoder().encode(importRowJson(row)).byteLength;

// Start with at most 256 rows. After each confirmed write, double or halve
// the next window using actual UTF-8 bytes and the fixed transport budget.
export function recommendImportBatchRows(rows,{
  maxBytes=IMPORT_PAYLOAD_TARGET_BYTES,maximum=IMPORT_FIRST_BATCH_ROWS,
  sampleSize=128
}={}){
  if(!Array.isArray(rows)||!Number.isSafeInteger(maxBytes)||maxBytes<1||
      !Number.isSafeInteger(maximum)||maximum<1||
      !Number.isSafeInteger(sampleSize)||sampleSize<1)
    throw new TypeError('Invalid import batch sample budget');
  const limit=Math.min(sampleSize,rows.length);
  if(!limit)return maximum;
  let bytes=0;
  for(let i=0;i<limit;i++)bytes+=importRowBytes(rows[i]);
  const average=Math.max(1,Math.ceil(bytes/limit)+2);
  // Physical writes still check EVERY row. This 90% headroom is only a
  // starting guess, not authorization to exceed the native request budget.
  return Math.max(1,Math.min(maximum,Math.floor(maxBytes*.9/average)));
}

// First confirmation at 4096, next at 8192, then every additional 8192.
// SQL transport may flush much earlier when real payload bytes demand it;
// those smaller confirmed writes keep their existing durable receipts.
export function createImportConfirmationWindow({
  firstRows=IMPORT_FIRST_CHECKPOINT_ROWS,maxRows=IMPORT_MAX_CHECKPOINT_ROWS
}={}){
  if(!Number.isSafeInteger(firstRows)||firstRows<1||
      !Number.isSafeInteger(maxRows)||maxRows<firstRows)
    throw new TypeError('Invalid import confirmation window');
  let next=firstRows;
  return {
    get next(){return next;},
    remaining(confirmed){
      if(!Number.isSafeInteger(confirmed)||confirmed<0)
        throw new TypeError('Invalid confirmed import row count');
      return Math.max(0,next-confirmed);
    },
    reached(confirmed){
      if(!Number.isSafeInteger(confirmed)||confirmed<0)
        throw new TypeError('Invalid confirmed import row count');
      if(confirmed<next)return false;
      do{next=next===firstRows
        ?(maxRows>firstRows?maxRows:firstRows+maxRows)
        :next+maxRows;}
      while(confirmed>=next);
      return true;
    }
  };
}
export function createImportBatchSizer({
  initial=IMPORT_FIRST_BATCH_ROWS,minimum=1,
  maximum=IMPORT_MAX_CHECKPOINT_ROWS,
  maxPayloadBytes=IMPORT_PAYLOAD_TARGET_BYTES,sampleRows=null
}={}){
  const guess=Array.isArray(sampleRows)&&sampleRows.length
    ?recommendImportBatchRows(sampleRows,{maxBytes:maxPayloadBytes,
      maximum:Math.min(initial,maximum)}):initial;
  const adaptive=createTextAdaptiveRows({initial:guess,minimum,maximum,
    targetChars:maxPayloadBytes});
  return {
    get size(){return adaptive.size;},
    get maxBytes(){return maxPayloadBytes;},
    // Include one JSON-array separator byte per row in the transport budget.
    byteSize:row=>importRowBytes(row)+1,
    // A larger logical window is safe only when EACH actual HTTP payload
    // stays below the existing byte target.
    shouldFlush(count,bytes,nextBytes=0){
      return count>0&&(count>=adaptive.size||
        bytes+nextBytes>maxPayloadBytes);
    },
    observe(rows,elapsedMs,payloadBytes=rows){
      // Adapt on actual UTF-8 bytes, not JavaScript UTF-16 character counts.
      return adaptive.observe(rows,payloadBytes);
    }
  };
}

// Read-only preview estimate from parsed item counts; not an ETA or a database probe.
// Conservative throughput bands account for date comparison and media linking,
// but actual backend/network latency and existing-record density vary.
export function estimateImportMinutes({articles=0,media=0}={}){
  const articleCount=Math.max(0,Math.floor(Number(articles)||0));
  const mediaCount=Math.max(0,Math.floor(Number(media)||0));
  if(!articleCount&&!mediaCount)return null;
  const min=Math.max(1,Math.ceil(0.5+articleCount/5500+mediaCount/5000));
  const max=Math.max(min+1,Math.ceil(2+articleCount/1200+mediaCount/1200));
  return {min,max};
}

// Only estimate the current measurable stage. Other comparison/write phases
// have independent work and must not be presented as part of this ETA.
export function estimateImportStageMinutes({completed=0,total=0,elapsedMs=0}={}){
  const done=Number(completed),all=Number(total),elapsed=Number(elapsedMs);
  if(!Number.isFinite(done)||!Number.isFinite(all)||!Number.isFinite(elapsed)||
      all<=0||done<=0||done>=all||elapsed<3000||done/all<.1)return null;
  const remainingMs=(elapsed/done)*(all-done);
  if(!Number.isFinite(remainingMs)||remainingMs<0||remainingMs>86400000)return null;
  return {underMinute:remainingMs<60000,minutes:Math.max(1,Math.ceil(remainingMs/60000))};
}

export function validImportBatchSize(){return HEAVY_QUERY_ROWS;}

export async function writeImportStream(records,{writeBatch,onProgress,total=null,
  sampleRows=null,signal}={}){
  const iterable=records&&(
    typeof records[Symbol.asyncIterator]==='function'||
    typeof records[Symbol.iterator]==='function');
  if(!iterable)throw new Error('匯入資料必須是可逐筆讀取的資料流。');
  if(typeof writeBatch!=='function')throw new Error('匯入寫入函式不存在。');
  if(total!==null&&(!Number.isSafeInteger(total)||total<0))
    throw new Error('匯入資料流筆數無效。');
  const sizer=createImportBatchSizer({sampleRows});
  const windows=createImportConfirmationWindow();
  const iterator=records[Symbol.asyncIterator]?.()||records[Symbol.iterator]();
  let completed=0,batches=0,lookahead,hasLookahead=false,finished=false;
  const readNext=async()=>{
    if(hasLookahead){const row=lookahead;lookahead=undefined;hasLookahead=false;
      return {done:false,value:row};}
    return await iterator.next();
  };
  try{for(;;){
    if(total!==null&&completed===total){
      const extra=await readNext();
      if(!extra.done)throw new Error('匯入資料流超過宣告筆數 '+total+' 筆。');
      finished=true;break;
    }
    const batch=[];
    const allowedRows=Math.min(sizer.size,windows.remaining(completed));
    let bytes=0;
    while(batch.length<allowedRows&&!finished&&
        (total===null||completed+batch.length<total)){
      if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
      const next=await readNext();
      if(next.done){finished=true;break;}
      const row=next.value,nextBytes=sizer.byteSize(row);
      if(nextBytes>sizer.maxBytes)
        throw new Error('單筆資料超出批次傳輸限制，無法安全寫入。');
      if(sizer.shouldFlush(batch.length,bytes,nextBytes)){
        lookahead=row;hasLookahead=true;break;
      }
      batch.push(row);bytes+=nextBytes;
      if(sizer.shouldFlush(batch.length,bytes))break;
    }
    if(!batch.length)break;
    const started=Date.now();
    try{
      const result=await writeBatch(batch,{offset:completed,total});
      if(result&&Number.isInteger(result.count)&&result.count!==batch.length)
        throw new Error('寫入筆數不符：預期 '+batch.length+' 筆，實際 '+result.count+' 筆');
    }catch(error){
      const detail=String(error?.message||error||'未知錯誤');
      throw new Error('第 '+(batches+1)+' 批失敗；已確認完成 '+completed+
        '／'+(total===null?'未知總數':total)+' 筆。'+detail+'。重新執行前會再次比對已存在 UID。');
    }
    completed+=batch.length;batches++;
    const checkpoint=windows.reached(completed);
    sizer.observe(batch.length,Date.now()-started,bytes);
    onProgress?.({completed,total,percent:total===null?null:
      Math.round(completed/Math.max(1,total)*100),checkpoint,batch:batches,
      batches:total===null?null:Math.max(batches,Math.ceil(total/sizer.size))});
  }}finally{
    if(!finished)await iterator.return?.();
  }
  if(total!==null&&completed!==total)
    throw new Error('匯入資料流筆數不符：預期 '+total+' 筆，實際 '+completed+' 筆。');
  return {completed,total:total??completed,batches};
}

export async function writeImportBatches(records,options={}){
  if(!Array.isArray(records))throw new Error('匯入批次資料必須是陣列。');
  async function* rows(){for(const row of records)yield row;}
  return writeImportStream(rows(),{...options,total:records.length,sampleRows:records});
}
