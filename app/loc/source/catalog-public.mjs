// Public, typed SiteAnchor source reader for Culture/Statistics.
// The public catalogue is resident in the release snapshot; only the
// protected editor uses the live LOC Anchor reader.
import {readAllAnchorFeature} from '../model/feature-query-client.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {sourceTaxonomyFromAnchors} from './classification.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';

export async function readPublicSourceAnchors({editor=false}={}){
  // The public SiteAnchor catalogue is shipped in the resident site bootstrap;
  // only the protected editor reads the live database projection.
  if(editor)return readAllAnchorFeature({scope:'loc',family:'source',editor:true});
  const rows=PUBLISHED_SITE_BOOTSTRAP.site_anchors;
  if(!Array.isArray(rows)||!rows.length)
    throw new Error('SiteAnchor 常駐資料尚未發佈，請執行公開資料同步。');
  const allowed=new Set(ANCHOR_TYPE_GROUPS.source);
  return rows.filter(row=>allowed.has(row?.type)&&row?.invisible!==true);
}

export async function readPublicSourceTaxonomy(){
  return sourceTaxonomyFromAnchors(await readPublicSourceAnchors());
}
