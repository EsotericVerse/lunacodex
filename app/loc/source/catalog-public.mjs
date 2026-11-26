// Public, typed SiteAnchor source reader for Culture/Statistics and management.
// SiteAnchor is fixed publication data; every read uses the resident release
// Asset and never opens a SQL connection.
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {sourceTaxonomyFromAnchors} from './classification.mjs';

// Change to 'sql' only for a deliberate compatibility fallback. Normal
// Culture/Statistics/Search/Import reads stay on the resident published Asset.
export const SITE_ANCHOR_READ_MODE='asset';

const readAsset=async()=>{
  const {PUBLISHED_SITE_BOOTSTRAP}=await import('../../modular/published-site-bootstrap.js');
  const rows=PUBLISHED_SITE_BOOTSTRAP.site_anchors;
  if(!Array.isArray(rows)||!rows.length)
    throw new Error('LOC 文章來源 Asset 尚未發佈。');
  const allowed=new Set(ANCHOR_TYPE_GROUPS.source);
  const visible=rows.filter(row=>allowed.has(row?.type)&&row?.invisible!==true);
  if(!visible.length)throw new Error('LOC 文章來源 Asset 尚未發佈。');
  return visible;
};

const readSqlFallback=async()=>{
  const {readPublicSourceAnchorsFromSql}=await import('../actions/anchor/source-fallback.mjs');
  return readPublicSourceAnchorsFromSql();
};

export async function resolveSiteAnchorRead({mode=SITE_ANCHOR_READ_MODE,
  loadAsset=readAsset,loadFallback=readSqlFallback}={}){
  if(mode!=='asset')return loadFallback();
  try{return await loadAsset();}
  catch{
    try{return await loadFallback();}
    catch{throw new Error('LOC 文章來源 Asset 無法讀取，固定 SQL 回退也失敗。');}
  }
}

export async function readPublicSourceAnchors(){
  return resolveSiteAnchorRead();
}

export async function readPublicSourceTaxonomy(){
  return sourceTaxonomyFromAnchors(await readPublicSourceAnchors());
}

export async function queryPublishedSourceAnchors(operation){
  const rows=(await readPublicSourceAnchors()).filter(row=>
    operation.types.includes(row.type)&&
    (!operation.uids||operation.uids.includes(row.uid))&&
    (!operation.cursor||row.uid>operation.cursor));
  if(operation.result==='count')return {total:rows.length};
  const direction=operation.sortDirection==='desc'?-1:1;
  const order=operation.order||'uid';
  rows.sort((left,right)=>{
    const a=String(left[order]??''),b=String(right[order]??'');
    const primary=a.localeCompare(b,'en')*direction;
    return primary||(order==='uid'?0:left.uid.localeCompare(right.uid));
  });
  const offset=operation.offset||0,limit=operation.limit;
  const page=rows.slice(offset,offset+limit+1);
  const data=page.slice(0,limit);
  return {rows:data,hasMore:page.length>limit,
    totalCount:operation.includeTotal?rows.length:null,
    nextCursor:page.length>limit&&data.length&&order==='uid'&&direction===1
      ?String(data.at(-1).uid):null};
}
