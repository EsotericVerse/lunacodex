// CMS-aware, read-only projection into LOC's existing Galaxy import contract.
// This value model is shared with LAS/MCP; the importer remains LOC-owned.
// No network requests, additional tables, permissions, caches or SQL writes.
import {createSchemaFactory} from '@zenstackhq/zod';
import {schema} from './schema.mjs';

const cmsImportSchema=createSchemaFactory(schema).makeTypeSchema('CmsImportArticle');
const supported=new Set(['wordpress','notion']);
const sourceLabel=Object.freeze({wordpress:'WordPress',notion:'Notion'});
const recordObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const string=value=>typeof value==='string'?value.trim():'';
const absoluteHttpUrl=value=>{
  try{
    const result=new URL(value);
    return /^https?:$/.test(result.protocol)?result.href:'';
  }catch{return '';}
};
const richTextText=parts=>Array.isArray(parts)?parts.map(part=>
  string(part?.plain_text)||string(part?.text?.content)).join(''):'';
const wpTitleEntities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",
  nbsp:' ',hellip:'…',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',
  ldquo:'“',rdquo:'”'});
function wordPressTitle(value){
  return string(value).replace(/<\\/?[a-z][^>]*>/gi,'')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi,(match,entity)=>{
      if(entity[0]==='#'){
        const hex=/^#x/i.test(entity);
        const n=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
        return Number.isInteger(n)&&n>0&&n<=0x10ffff&&
          !(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):match;
      }
      return wpTitleEntities[entity.toLowerCase()]??match;
    });
}

function wordPressShape(row){
  return recordObject(row)&&recordObject(row.title)&&
    typeof row.title.rendered==='string'&&recordObject(row.content)&&
    typeof row.content.rendered==='string'&&
    (row.id!==undefined||row.type==='post'||row.type==='page');
}
function notionShape(row){
  return recordObject(row)&&(row.object==='page'||
    recordObject(row.properties)&&typeof row.id==='string'&&
    (Array.isArray(row.blocks)||Array.isArray(row.children)));
}

/** Only unambiguous native API shapes are autodetected. User choice can select
 * the CMS adapter but never turn unrelated input into a different CMS record. */
export function detectCmsImportSource(row){
  if(wordPressShape(row))return sourceLabel.wordpress;
  if(notionShape(row))return sourceLabel.notion;
  return '';
}

function publishedAt(row){
  const utc=string(row.date_gmt);
  if(utc&&utc!=='0000-00-00T00:00:00'){
    const suffix=/[zZ]|[+-]\d{2}:?\d{2}$/.test(utc)?'':'Z';
    const iso=new Date(utc+suffix);
    if(!Number.isNaN(iso.getTime()))return iso.toISOString();
  }
  // A timezone-naive WordPress local timestamp cannot be converted safely.
  const local=string(row.date);
  if(local&&!/[zZ]|[+-]\\d{2}:?\\d{2}$/.test(local))
    throw new Error('WordPress date 缺少時區；請提供 date_gmt，避免匯入錯誤時間');
  return local;
}
function wpArticle(row){
  const url=absoluteHttpUrl(row.link)||absoluteHttpUrl(row.url);
  const nativeId=row.id==null?'':String(row.id).trim();
  // WP post IDs are local to each installation, never globally unique.
  const sourceId=nativeId&&url?new URL(url).origin+':'+nativeId:'';
  const media=(Array.isArray(row._embedded?.['wp:featuredmedia'])?
    row._embedded['wp:featuredmedia']:[]).map(item=>
    absoluteHttpUrl(item?.source_url)).filter(Boolean)
    .map(url=>({media_type:'image',url}));
  if(Number(row.featured_media)>0&&!media.length)
    throw new Error('WordPress 有精選圖片但沒有媒體網址；請使用含 _embed 的 REST 資料重新匯出');
  const time=publishedAt(row);
  return {cms:'wordpress',...(sourceId?{sourceId}:{}),
    title:wordPressTitle(row.title.raw||row.title.rendered),body:row.content.rendered,
    ...(time?{createdAt:time}:{}),
    ...(url?{canonicalUrl:url}:{}),...(media.length?{media}:{})};
}
function notionPageTitle(row){
  for(const property of Object.values(row.properties||{})){
    if(property?.type==='title'||Array.isArray(property?.title)){
      const text=richTextText(property.title);
      if(text)return text;
    }
  }
  return richTextText(row.title)||string(row.title);
}
function notionText(block){
  const kind=string(block?.type);
  const value=recordObject(block?.[kind])?block[kind]:block;
  if(kind==='child_page')return string(value.title);
  if(kind==='bookmark'||kind==='embed')return string(value.url);
  if(kind==='equation')return string(value.expression);
  if(kind==='table_row')return Array.isArray(value.cells)?
    value.cells.map(richTextText).join(' | '):'';
  if(kind==='child_database')return string(value.title);
  const text=richTextText(value?.rich_text||value?.title);
  const prefix=kind==='bulleted_list_item'?'- ':
    kind==='numbered_list_item'?'1. ':
    kind==='to_do'?(value.checked?'[x] ':'[ ] '):
    kind==='heading_1'?'# ':kind==='heading_2'?'## ':
    kind==='heading_3'?'### ':'';
  return text?prefix+text:'';
}
function notionFlatten(blocks,parts,media,depth=0){
  if(depth>8)throw new Error('Notion 區塊層級超過支援深度，已停止匯入避免資料遺失');
  for(const block of blocks){
    if(!recordObject(block))continue;
    const type=string(block.type);
    const data=recordObject(block[type])?block[type]:{};
    const content=notionText(block);
    if(content)parts.push(content);
    if(['image','video','file','pdf','audio'].includes(type)&&data?.file?.url)
      throw new Error('Notion 內建附件網址具有期限，無法直接當永久媒體匯入；請先提供可保存的媒體');
    if(['image','video'].includes(type)){
      // Notion-hosted file URLs expire; only external HTTP URLs qualify.
      const url=absoluteHttpUrl(data?.external?.url);
      if(url)media.push({media_type:type,url});
    }
    if(block.has_children===true&&!Array.isArray(block.children)){
      throw new Error('Notion 頁面包含尚未提供的子區塊；請先匯出完整 Block Children');
    }
    if(Array.isArray(block.children))notionFlatten(block.children,parts,media,depth+1);
  }
}
function notionArticle(row){
  const blocks=Array.isArray(row.blocks)?row.blocks:
    Array.isArray(row.children)?row.children:null;
  if(!blocks)throw new Error('Notion Page 只有 Properties，沒有正文 Block Children；請匯入包含 Blocks 的完整資料');
  const parts=[],media=[];
  notionFlatten(blocks,parts,media);
  const url=absoluteHttpUrl(row.url)||absoluteHttpUrl(row.public_url);
  return {cms:'notion',...(string(row.id)?{sourceId:row.id}:{}),
    title:notionPageTitle(row),body:parts.join('\n\n'),
    ...(string(row.created_time)?{createdAt:row.created_time}:{}),
    ...(url?{canonicalUrl:url}:{}),...(media.length?{media}:{})};
}

/** Convert only recognized source shapes. Never mutate the source object.
 * The flat fields reach the existing LOC UID, dedup, Anchor, ZModel/Zod and
 * authorized Kysely write pipeline. */
export function normalizeCmsImportRow(input,selectedSource=''){
  const source=String(selectedSource||'').trim();
  const detected=detectCmsImportSource(input);
  if(!detected){
    const declared=source.toLowerCase();
    if(recordObject(input?.content)||recordObject(input?.title)||
      (supported.has(declared)&&input?.object==='page'))
      throw new Error('CMS 正文或標題是結構化資料，但找不到相符來源模型；已停止匯入避免產生 [object Object]');
    return {row:input,source};
  }
  const declared=source.toLowerCase();
  if(supported.has(declared)&&declared!==detected.toLowerCase())
    throw new Error('選擇的 CMS 類型與實際匯出格式不一致：'+source+' / '+detected);
  const cms=detected.toLowerCase();
  if(!supported.has(cms))return {row:input,source};
  const candidate=cms==='wordpress'?wpArticle(input):notionArticle(input);
  const checked=cmsImportSchema.safeParse(candidate);
  if(!checked.success)throw new Error('CMS ZModel 驗證失敗：'+
    (checked.error.issues[0]?.path?.join('.')||'record'));
  const value=checked.data;
  if(!string(value.body))throw new Error(detected+' 正文為空；不使用摘要、標題或媒體替代文章');
  // Preserve native data. Explicit LOC-compatible scalar fields win.
  const result={...input,
    title:input?.title&&typeof input.title==='string'?input.title:value.title||'',
    content:typeof input?.content==='string'?input.content:value.body,
    createtime:input?.createtime||value.createdAt||null,
    site_id:input?.site_id||value.sourceId||null,
    url:input?.url||value.canonicalUrl||null,
    ...(!input?.media&&value.media?{media:value.media}:{})};
  const chosen=source.toLowerCase();
  const canonicalSource=!source||chosen==='others'?detected:source;
  return {row:result,source:canonicalSource};
}
