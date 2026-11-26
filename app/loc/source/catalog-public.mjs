// Public, typed SiteAnchor source reader for Culture/Statistics and management.
// The fixed ZModel catalogue is published into the resident JavaScript bundle;
// feature reads must never open a SQL connection or depend on Cloudflare ASSETS.
import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {sourceTaxonomyFromAnchors} from './classification.mjs';

// This is a versioned JS snapshot, not the Cloudflare Workers ASSETS binding
// and not R2. Update it only through the explicit public publication flow.
export const SITE_ANCHOR_READ_MODE='published-js';

const readPublished=()=>{
  const rows=PUBLISHED_SITE_BOOTSTRAP.site_anchors;
  if(!Array.isArray(rows)||!rows.length)
    throw new Error('LOC SiteAnchor JS 發布資料缺失；請執行 sync:public 並檢查產生檔。');
  const allowed=new Set(ANCHOR_TYPE_GROUPS.source);
  const visible=rows.filter(row=>allowed.has(row?.type)&&row?.invisible!==true);
  if(!visible.length)
    throw new Error('LOC SiteAnchor JS 發布資料沒有可用的公開節點。');
  return visible;
};

export async function readPublicSourceAnchors(){
  return readPublished();
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
