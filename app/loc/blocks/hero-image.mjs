// One place for the hero/frame image contract shared by every editor and display.
import {defaultHeroImageForPage,isLocHeroPage} from './home-block-model.js';

// block_image is a text column: the DB returns JSON text, writes go in as JSON.
export function parseBlockImage(value){
  if(value&&typeof value==='object')return value;
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const parsed=JSON.parse(value);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }catch{
    // Historical published Blocks stored only the URL in block_image.
    // Preserve the exact URL and never replace it with a generated asset.
    const raw=value.trim();
    return (/^\/(?!\/)[^\s]*$/u.test(raw)||/^https?:\/\/[^\s]+$/iu.test(raw))
      ?{source:'custom',url:raw}:null;
  }
}

export function heroImageUrl(row){
  return String(parseBlockImage(row?.block_image)?.url||'');
}

const LOC_HERO_ASSET_FILES=new Set([
  'LOC-admin.jpg','LOC-culture.jpg','LOC-gn.jpg','LOC-search.jpg','LOC-statics.jpg',
  'scope-culture.jpg','scope-gn.jpg','scope-manage.jpg','scope-search.jpg',
  'scope-statics.jpg','local-setting.jpg'
]);
function imageFilename(value){
  return String(value||'').split(/[?#]/,1)[0].split('/').pop()||'';
}

// A previously crossed LOC asset name must not keep overriding the route's
// fixed artwork. User supplied URLs outside this named asset set stay intact.
export function normalizeHeroImageForPage(scopeId,pageName,value){
  const parsed=parseBlockImage(value);
  const expected=defaultHeroImageForPage(scopeId,pageName);
  if(!parsed)return expected?{source:'custom',url:expected}:null;
  if(!expected)return parsed;
  if(parsed.source==='none'||!parsed.url)return {source:'custom',url:expected};
  const actualFile=imageFilename(parsed.url);
  const expectedFile=imageFilename(expected);
  return LOC_HERO_ASSET_FILES.has(actualFile)&&actualFile!==expectedFile
    ?{...parsed,url:expected}:parsed;
}

export function heroImageUrlForPage(row,scopeId,pageName){
  return String(normalizeHeroImageForPage(scopeId,pageName,row?.block_image)?.url||'');
}

export function absoluteImageUrl(src){
  try{return src?new URL(src,window.location.origin).href:'';}catch{return src||'';}
}

// Blocks whose image is edited as a frame image: LOC/Author home blocks and
// the LunaRunes hero/game heroes.
export function isHomeFrameFor(scopeId,pageName,order){
  const n=Number(order);
  if(!(n>=1))return false;
  if(scopeId==='lrunes')return ['index','hero','game'].includes(pageName);
  return (pageName==='index'&&['loc','lo3rwang'].includes(scopeId))||
    (scopeId==='loc'&&n===1&&isLocHeroPage(pageName));
}
