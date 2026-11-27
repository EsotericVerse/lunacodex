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
// admin is LOC Group administration and uses group_admin for both copy and
// artwork. setting uses group_setting for both. Scope /trace/manage is the
// spatial-anchor editor (view='manage') even when its root Scope ID is loc;
// Group people/works management is the distinct view='sourceManage'.
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
// Each route owns one Hero row that stores its copy and image together. Keep
// these page names aligned with LOC_MANAGEMENT_ROUTE_TABLE and the SQL rows.
export const MANAGEMENT_HERO_SLOTS=Object.freeze([
  {key:'time',label:'時間定錨',audience:'scope',featureId:'culture',page:'TimeAnchor',englishTitle:'Time Anchor'},
  {key:'keywords',label:'關鍵詞',audience:'scope',featureId:'statics',page:'Groupkeyword',englishTitle:'Keywords'},
  {key:'spatial',label:'空間定錨',audience:'scope',featureId:'trace',page:'SpaceAnchor',englishTitle:'Space Anchor'},
  {key:'advanced',label:'文章管理',audience:'scope',featureId:'search',page:'GroupArticle',englishTitle:'Article Management'},
  {key:'system',label:'系統管理',audience:'loc',page:'group_admin',englishTitle:'Administration'},
  {key:'members',label:'群組管理',audience:'loc',page:'GalaxyManage',englishTitle:'Group Management'},
  {key:'locKeywords',label:'關鍵詞',audience:'loc',page:'Groupkeyword',englishTitle:'Keywords'},
  {key:'articles',label:'文章管理',audience:'loc',page:'GroupArticle',englishTitle:'Article Management'}
]);
const heroImageUrl=file=>file?'https://loc.lo3rwang.cc/pics/'+file:'';
const FEATURE_HERO_DEFAULT_IMAGES=Object.freeze({
  culture:'scope-culture.jpg',
  statics:'scope-statics.jpg',
  trace:'scope-gn.jpg',
  search:'scope-search.jpg',
  admin:'LOC-admin.jpg',
  manage:'scope-manage.jpg',
  setting:'local-setting.jpg'
});
const MANAGEMENT_HERO_DEFAULT_IMAGES=Object.freeze({
  time:'LOC-culture.jpg',
  keywords:'LOC-statics.jpg',
  spatial:'LOC-gn.jpg',
  advanced:'LOC-search.jpg',
  system:'LOC-admin.jpg',
  members:'scope-manage.jpg',
  locKeywords:'LOC-statics.jpg',
  articles:'LOC-search.jpg'
});
const MANAGEMENT_HERO_COPY=Object.freeze({
  TimeAnchor:{eyebrow:'Time Anchor',title:'時間定錨'},
  ScopeKeyword:{eyebrow:'Keywords',title:'關鍵詞'},
  SpaceAnchor:{eyebrow:'Space Anchor',title:'空間定錨'},
  ScopeArticle:{eyebrow:'Article Management',title:'文章管理'},
  group_admin:{eyebrow:'Administration',title:'系統管理'},
  GalaxyManage:{eyebrow:'Group Management',title:'群組管理'},
  Groupkeyword:{eyebrow:'Keywords',title:'關鍵詞'},
  GroupArticle:{eyebrow:'Article Management',title:'文章管理'},
  group_culture:{eyebrow:'Culture',title:'文化'},
  group_statics:{eyebrow:'Statistics',title:'統計'},
  group_trace:{eyebrow:'Trace',title:'痕跡'},
  group_search:{eyebrow:'Search',title:'搜尋'},
  group_setting:{eyebrow:'Personal Settings',title:'個人設定'}
});
export function featureHeroDefaultImage(featureId){
  const file=FEATURE_HERO_DEFAULT_IMAGES[String(featureId||'')];
  return heroImageUrl(file);
}
export function managementHeroImagePage(slot){
  // The Hero image and its copy are fields on the same LOC Anchor row.
  return slot?.page||'group_admin';
}
export function managementHeroDefaultImage(slot){
  return heroImageUrl(MANAGEMENT_HERO_DEFAULT_IMAGES[slot?.key]||'');
}
export function defaultHeroImageForPage(scopeId,pageName='index'){
  const page=String(pageName||'index').trim();
  const groupPage=/^group_(.+)$/.exec(page);
  if(groupPage)return featureHeroDefaultImage(groupPage[1]);
  const slot=MANAGEMENT_HERO_SLOTS.find(item=>item.page===page);
  if(slot)return managementHeroDefaultImage(slot);
  return '';
}
export function isLocHeroPage(pageName='index'){
  const page=String(pageName||'index').trim();
  return Boolean(MANAGEMENT_HERO_COPY[page]||
    /^group_(?:culture|statics|trace|search|admin|manage|setting)$/.test(page));
}
export function defaultHeroCopyForPage(pageName='index'){
  const page=String(pageName||'index').trim();
  return MANAGEMENT_HERO_COPY[page]||{eyebrow:'',title:''};
}
const normalizeHeroToken=value=>String(value||'').toLowerCase().replace(/[\s_-]+/g,'');
const internalHeroTokens=new Set([
  ...Object.keys(MANAGEMENT_HERO_COPY),
  'TimeAnchor','ScopeKeyword','SpaceAnchor','ScopeArticle','GalaxyManage',
  'Groupkeyword','GroupArticle',
  ...[...Object.values(FEATURE_HERO_DEFAULT_IMAGES),
    ...Object.values(MANAGEMENT_HERO_DEFAULT_IMAGES)].flatMap(file=>[
      file,file.replace(/\.[^.]+$/,'')
    ])
].map(normalizeHeroToken));
export function normalizeHeroCopyValue(pageName,field,value){
  const text=String(value??'').trim();
  if(!text||!internalHeroTokens.has(normalizeHeroToken(text)))return text;
  const defaults=defaultHeroCopyForPage(pageName);
  return String(defaults[field]||'');
}

export function managementHeroSlot(view='',scopeId=''){
  // Root /culture/manage and /trace/manage are Scope-admin destinations even
  // though their shell uses the aggregate LOC Scope ID. Group people/works
  // remains the separate /manage route (view='sourceManage').
  const group=scopeId==='loc'||scopeId==='admin';
  const key=view==='timeManage'?'time':view==='manage'?'spatial':group
    ?({admin:'system',sourceManage:'members',keywordManage:'locKeywords',searchManage:'articles'}[view])
    :({keywords:'keywords',searchManage:'advanced'}[view]);
  return MANAGEMENT_HERO_SLOTS.find(item=>item.key===key)||null;
}
export function managementHeroCopy(rows,slot){
  if(!slot)return null;
  const row=(Array.isArray(rows)?rows:[]).find(item=>Number(item?.block_order)===1);
  const defaults=defaultHeroCopyForPage(slot.page);
  if(!row)return {eyebrow:defaults.eyebrow||'',title:defaults.title||String(slot.label||'').trim(),subtitle:'',description:''};
  return {
    eyebrow:normalizeHeroCopyValue(slot.page,'eyebrow',row.block_eyebrow),
    title:normalizeHeroCopyValue(slot.page,'title',row.block_title)||defaults.title||String(slot.label||'').trim(),
    subtitle:String(row?.block_subtitle||'').trim(),
    description:String(row?.block_text||'').trim()
  };
}

// These features use the compact single-image editor. Storage-page selection
// is separate: Group admin/settings use group_*; Scope management uses its
// dedicated named page.
export const SINGLE_SLOT_FEATURE_HERO_IDS=Object.freeze(['admin','manage','setting']);
export function shouldUseSingleFeatureHeroImage(featureId){
  return SINGLE_SLOT_FEATURE_HERO_IDS.includes(String(featureId||''));
}

export function featureHeroPageFor(featureId){
  const id=String(featureId||'');
  return 'group_'+id;
}

export function featureHeroImagePageFor(featureId){
  const id=String(featureId||'');
  if(id==='admin'||id==='setting')return featureHeroPageFor(id);
  return shouldUseSingleFeatureHeroImage(id)?'scope_'+id:featureHeroPageFor(id);
}

export function sharedFeatureHeroFor(rows,pageName=''){
  const row=(Array.isArray(rows)?rows:[]).find(item=>Number(item?.block_order)===1);
  if(!row)return null;
  return {
    eyebrow:normalizeHeroCopyValue(pageName,'eyebrow',row.block_eyebrow),
    title:normalizeHeroCopyValue(pageName,'title',row.block_title),
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
  childPresentation,
  removeDuplicatedLegacySubtitle,
  plainBlockLine,
  featureHeroPageFor,
  featureHeroImagePageFor,
  FEATURE_HERO_ORDER,
  FEATURE_HERO_IDS,
  featureHeroFor:sharedFeatureHeroFor,
  shouldUseSharedFeatureHero,
  SINGLE_SLOT_FEATURE_HERO_IDS,
  shouldUseSingleFeatureHeroImage,
  MANAGEMENT_HERO_SLOTS,
  featureHeroDefaultImage,
  defaultHeroImageForPage,
  defaultHeroCopyForPage,
  normalizeHeroCopyValue,
  isLocHeroPage,
  managementHeroSlot,
  managementHeroImagePage,
  managementHeroDefaultImage,
  managementHeroCopy
});
