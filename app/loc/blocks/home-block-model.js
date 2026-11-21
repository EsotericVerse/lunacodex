// U+FFFC is ProseMirror's representation of a leaf/embedded object.
// Convert only orphan placeholder-only paragraphs into actual HTML line breaks from LOC's legacy HTML.
// Never remove the marker inside meaningful text or media markup: it may
// represent an actual inline attachment that needs separate migration.
const placeholderParagraph=/<p\b[^>]*>\s*(?:(?:\uFFFC|&#0*65532;|&#x0*fffc;)\s*)+<\/p>/gi;

export function stripLocHomeEditorPlaceholders(html=''){
  return String(html??'').replace(placeholderParagraph,'<p><br></p>');
}


export const HOME_BLOCK_ENTITY_LIMIT=6;
const UID_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createHomeBlockUid(){
  const bytes=new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  let uid='';
  for(let index=0;index<8;index+=1){
    const value=bytes[index]??Math.floor(Math.random()*UID_ALPHABET.length);
    uid+=UID_ALPHABET[value%UID_ALPHABET.length];
  }
  return uid;
}


// The first JSONB array item is an optional presentation column count.
export const HOME_BUBBLE_COLUMNS=Object.freeze([2,3,6]);
export function defaultHomeBubbleColumns(pageName='index'){
  const page=String(pageName||'index').toLowerCase();
  return page==='search'?6:page==='trace'?2:3;
}
export function homeBubbleColumns(value,pageName='index'){
  const first=Array.isArray(value)?value[0]:null;
  return HOME_BUBBLE_COLUMNS.includes(first)?first:defaultHomeBubbleColumns(pageName);
}
export function homeBubbleEntities(value){
  return Array.isArray(value)?(typeof value[0]==='number'?value.slice(1):value):[];
}
export function serializeHomeBubbleEntities(columns,entities,pageName='index'){
  const count=HOME_BUBBLE_COLUMNS.includes(columns)?columns:defaultHomeBubbleColumns(pageName);
  return [count,...entities];
}

export function normalizeHomeBlockEntities(value){
  const rows=homeBubbleEntities(value);
  return rows.slice(0,HOME_BLOCK_ENTITY_LIMIT).map((entity,index)=>({
    uid:/^[A-Za-z0-9]{8}$/.test(String(entity?.uid||''))?String(entity.uid):createHomeBlockUid(),
    title:String(entity?.title||''),
    text:String(entity?.text||''),
    ...(entity?.image_mode==='side'?{image_mode:'side'}:{}),
    order:index+1
  }));
}


// Block 1 is the fixed homepage Hero; ordinary frames may only reorder below it.
export function isPinnedHomeHero(pageName,block){
  return ['index','hero'].includes(String(pageName||'').toLowerCase())&&Number(block?.order)===1;
}
export function canSwapHomeBlockPositions(pageName,blocks,fromIndex,toIndex){
  if(!Array.isArray(blocks)||!Number.isInteger(fromIndex)||!Number.isInteger(toIndex)||
      fromIndex<0||toIndex<0||fromIndex>=blocks.length||toIndex>=blocks.length)return false;
  return !isPinnedHomeHero(pageName,blocks[fromIndex])&&!isPinnedHomeHero(pageName,blocks[toIndex]);
}

export const HOME_BLOCK_LIMIT=8;

// VARCHAR headings are plain strings; remove only legacy markup wrappers.
export function plainBlockLine(value=''){
  return String(value??'').replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#0*160;|&#x0*a0;/gi,' ')
    .replace(/\s+/g,' ').trim();
}


/** One indexed page row is one text frame; repeat neither row nor field. */
export function homeBlockRows(rows,page='index',limit=HOME_BLOCK_LIMIT){
  const target=String(page||'index').toLowerCase();
  return (Array.isArray(rows)?rows:[])
    .filter(row=>String(row?.page_name||'index').toLowerCase()===target)
    .filter(row=>Number.isInteger(Number(row?.block_order))&&Number(row.block_order)>=1&&Number(row.block_order)<=limit)
    .sort((a,b)=>Number(a.block_order)-Number(b.block_order))
    .slice(0,limit);
}

function textSignature(value){
  return stripLocHomeEditorPlaceholders(value||'')
    .replace(/<br\b[^>]*>/gi,' ')
    .replace(/<[^>]*>/g,'')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi,' ')
    .replace(/\uFFFC/g,'')
    .replace(/\s+/g,'')
    .trim();
}

/** Only suppress empty placeholder entries and byte-equivalent legacy copies
 * of a populated canonical field. All other child entries remain in DB order. */
export function visibleHomeEntities(slot){
  const signatures=new Set([
    slot?.eyebrow,slot?.title,slot?.subtitle,slot?.text
  ].map(textSignature).filter(Boolean));
  return (Array.isArray(slot?.entities)?slot.entities:[]).filter(entity=>{
    const title=textSignature(entity?.title);
    const body=textSignature(entity?.text);
    const hasMedia=/<(?:img|picture|video|audio|iframe|svg)\b/i.test(String(entity?.text||''));
    if(!title&&!body&&!hasMedia)return false;
    if(!title&&body&&signatures.has(body))return false;
    if(title&&body&&signatures.has(body))return false;
    if(title&&!body&&!hasMedia&&signatures.has(title))return false;
    return true;
  });
}

// A child with no title is a bubble; entering a title turns it into a text card.
// No type selector or additional schema field is required.
export function childPresentation(title=''){
  return String(title??'').trim()?'card':'bubble';
}

// Legacy LOC homepage headers were stored in the first <p> of block_text.
// Never mutate the DB during rendering; avoid rendering that paragraph twice.
export function removeDuplicatedLegacySubtitle(body='',subtitle=''){
  const text=String(body??'');
  const heading=String(subtitle??'');
  if(!heading)return text;
  return text.startsWith(heading)?text.slice(heading.length):text;
}

// Feature headers share LOC-managed Hero rows on silver.loc_anchor,
// normally page_name='group_<feature>', block_order always 1. Trace uses group_trace (the same identifier as the feature route).
// (the same symmetric "<kind>_<feature>" naming already used for the 8
// feature-hero images, see admin-panels/FeatureHeroImages.jsx). block_order
// is purely "which block within this page" -- it never stands in for which
// feature; the page_name already does that job. LOC edits the group_<feature>
// row's text in place from the admin 功能區塊設定 panel; every Scope reads
// it read-only. The matching scope_<feature> row (see FeatureHeroImages.jsx)
// only ever carries that Scope-view's image override, never text.
// LunaRunes uses the same database-backed read-only feature headers as every
// other public Scope; only LOC admins edit the shared group_<feature> copy.
// admin / manage / setting (the /admin, each Scope's own /manage,
// and the local Scope's /local/setting pages) join this same hero template,
// but each is its own independent featureId -- they never share text or an
// image with each other or with the four above. None of them ever renders
// under scopeId==='loc' (loc's own management entry point is /admin itself,
// never /manage; /admin and /local/setting are each pinned to
// exactly one fixed Scope), so unlike the four above, none of them needs
// the group_<feature>/scope_<feature> two-slot split -- one image each,
// via shouldUseSingleFeatureHeroImage below.
export const FEATURE_HERO_ORDER=Object.freeze({
  culture:1,
  statics:2,
  search:3,
  trace:4,
  admin:5,
  manage:6,
  setting:7
});
export const FEATURE_HERO_IDS=Object.freeze(Object.keys(FEATURE_HERO_ORDER));
// Management titles and content live on independently named pages.
// Scope and Admin management groups each have ONE editable shared image page.
// Never use block_order to multiplex unrelated Hero documents into group_manage.
export const MANAGEMENT_HERO_IMAGE_URL='https://loc.lo3rwang.cc/pics/scope-gn.jpg';
export const MANAGEMENT_HERO_SLOTS=Object.freeze([
  {key:'time',label:'時間定錨',audience:'scope',featureId:'culture',page:'TimeAnchor',englishTitle:'TimeAnchor'},
  {key:'keywords',label:'關鍵詞',audience:'scope',featureId:'statics',page:'ScopeKeyword',englishTitle:'ScopeKeyword'},
  {key:'spatial',label:'空間定錨',audience:'scope',featureId:'trace',page:'SpaceAnchor',englishTitle:'SpaceAnchor'},
  {key:'advanced',label:'進階搜尋',audience:'scope',featureId:'search',page:'ScopeAdvSearch',englishTitle:'ScopeAdvSearch'},
  {key:'system',label:'系統管理',audience:'loc',page:'scope_admin',englishTitle:'Administration'},
  {key:'members',label:'人員作品管理',audience:'loc',page:'GalaxyManage',englishTitle:'GalaxyManage'},
  {key:'locKeywords',label:'關鍵詞',audience:'loc',page:'Groupkeyword',englishTitle:'Groupkeyword'},
  {key:'trace',label:'痕跡圖管理',audience:'loc',page:'GroupSpace',englishTitle:'GroupSpace'},
  {key:'articles',label:'文章管理',audience:'loc',page:'GroupArticle',englishTitle:'GroupArticle'}
]);
const LOC_MANAGEMENT_HERO_IMAGES=Object.freeze({
  members:'https://loc.lo3rwang.cc/pics/LOC-culture.jpg',
  locKeywords:'https://loc.lo3rwang.cc/pics/LOC-statics.jpg',
  trace:'https://loc.lo3rwang.cc/pics/LOC-gn.jpg',
  articles:'https://loc.lo3rwang.cc/pics/LOC-search.jpg'
});
export function managementHeroImagePage(slot){
  // System Admin keeps scope_admin; individual LOC management entries own
  // their own image field alongside their separately saved Hero text.
  return slot?.audience==='loc'&&slot.key!=='system'?slot.page:
    slot?.audience==='loc'?'scope_admin':'scope_manage';
}
export function managementHeroDefaultImage(slot){
  return slot?.audience==='loc'
    ?LOC_MANAGEMENT_HERO_IMAGES[slot.key]||'https://loc.lo3rwang.cc/pics/LOC-admin.jpg'
    :MANAGEMENT_HERO_IMAGE_URL;
}

export function managementHeroSlot(pathname='',scopeId='',editing=false,featureId=''){
  const parts=String(pathname||'').toLowerCase().split('/').filter(Boolean);
  const loc=scopeId==='loc'||scopeId==='admin';
  let key='';
  if(loc){
    // Admin is system-only; article management belongs to the Scope entry.
    if(parts[0]==='admin')return null;
    else if(parts[0]==='culture'&&parts.includes('manage'))key='members';
    else if(parts[0]==='statics'&&parts.includes('manage'))key='locKeywords';
    else if(parts[0]==='trace'&&parts.includes('manage'))key='trace';
    else if(parts[0]==='search'&&parts.includes('manage'))key='articles';
    else if(editing)key=parts.includes('culture')?'members':parts.includes('statics')?'locKeywords':parts.includes('search')?'articles':'trace';
  }else{
    // Prefer the actual feature instead of the generic /manage pathname:
    // culture, statistics, trace and search need four distinct editor Heroes.
    const featureSlots={culture:'time',statics:'keywords',trace:'spatial',search:'advanced'};
    if(featureId==='setting'||parts.includes('setting'))return null;
    if(featureSlots[featureId]&&(editing||parts.includes('manage')||parts.includes('keywords')))
      key=featureSlots[featureId];
    else if(featureId==='manage')key=parts.includes('search')?'advanced':'spatial';
    else if(parts.includes('manage')&&parts.includes('search'))key='advanced';
    else if(parts.includes('manage')&&parts.includes('culture'))key='time';
    else if(parts.includes('manage')&&parts.includes('statics'))key='keywords';
    else if(parts.includes('manage'))key='spatial';
    else if(parts.includes('keywords'))key='keywords';
  }
  return MANAGEMENT_HERO_SLOTS.find(slot=>slot.key===key)||null;
}
export function managementHeroCopy(rows,slot){
  if(!slot)return null;
  const row=(Array.isArray(rows)?rows:[]).find(item=>Number(item?.block_order)===1);
  return {
    eyebrow:String(row?.block_eyebrow||slot.englishTitle||'').trim(),
    title:String(row?.block_title||'').trim()||slot.label,
    subtitle:String(row?.block_subtitle||'').trim(),
    description:String(row?.block_text||'').trim()
  };
}

// The three single-image features (see comment above): exactly one
// silver.loc_blocks page_name="scope_<feature>" row, never a "group_" row.
export const SINGLE_SLOT_FEATURE_HERO_IDS=Object.freeze(['admin','manage','setting']);
export function shouldUseSingleFeatureHeroImage(featureId){
  return SINGLE_SLOT_FEATURE_HERO_IDS.includes(String(featureId||''));
}

export function featureHeroPageFor(featureId){
  const id=String(featureId||'');
  return 'group_'+id;
}

export function sharedFeatureHeroFor(rows){
  const row=(Array.isArray(rows)?rows:[]).find(item=>Number(item?.block_order)===1);
  if(!row)return null;
  return {
    eyebrow:String(row.block_eyebrow||'').trim(),
    title:String(row.block_title||'').trim(),
    subtitle:String(row.block_subtitle||''),
    description:String(row.block_text||'')
  };
}

export function shouldUseSharedFeatureHero(scopeId,featureId){
  const id=String(featureId||'');
  if(!scopeId||!FEATURE_HERO_ORDER[id])return false;
  // Only the four public LunaRunes features opt back into the same DB-backed
  // group_<feature> copy used by every other Scope. Keep other rune surfaces
  // unchanged. FeaturePage already loads the corresponding image slot.
  return scopeId!=='lrunes'||['culture','statics','search','trace'].includes(id);
}

// Three fixed personal signs; no public editor, image field, or DB setting can select them.
const FIXED_HERO_SIGNS=Object.freeze({
  loc:Object.freeze({key:'codex',label:'LOC 圓環中心實心點標誌',text:''}),
  lo3rwang:Object.freeze({key:'anchor',label:'光之定錨點',text:'光之定錨點'}),
  lrunes:Object.freeze({key:'moon',label:'玄韻家黃色圓點標誌',text:''})
});

export function heroExtraFor(scopeId=''){
  return FIXED_HERO_SIGNS[String(scopeId||'')]||null;
}

/** Composable home frames, children and feature-page headers share one object. */
export const HomeBlock=Object.freeze({
  entityLimit:HOME_BLOCK_ENTITY_LIMIT,
  createUid:createHomeBlockUid,
  normalizeEntities:normalizeHomeBlockEntities,
  bubbleColumns:homeBubbleColumns,
  defaultBubbleColumns:defaultHomeBubbleColumns,
  serializeBubbleEntities:serializeHomeBubbleEntities,
  limit:HOME_BLOCK_LIMIT,
  isPinnedHomeHero,
  canSwapHomeBlockPositions,
  rows:homeBlockRows,
  visibleEntities:visibleHomeEntities,
  stripLocHomeEditorPlaceholders,
  heroExtraFor,
  childPresentation,
  removeDuplicatedLegacySubtitle,
  plainBlockLine,
  featureHeroPageFor,
  FEATURE_HERO_ORDER,
  FEATURE_HERO_IDS,
  featureHeroFor:sharedFeatureHeroFor,
  shouldUseSharedFeatureHero,
  SINGLE_SLOT_FEATURE_HERO_IDS,
  shouldUseSingleFeatureHeroImage,
  MANAGEMENT_HERO_SLOTS,
  MANAGEMENT_HERO_IMAGE_URL,
  managementHeroSlot,
  managementHeroImagePage,
  managementHeroDefaultImage,
  managementHeroCopy
});
