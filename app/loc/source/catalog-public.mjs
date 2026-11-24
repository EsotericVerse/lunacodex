// Public, typed SiteAnchor source reader for Culture/Statistics.
// The protected Admin Source editor uses its own LOC-managed action;
// both paths share the same canonical Source discriminator set.
// Pagination uses LOC's existing Kysely read helper: it must not silently
// truncate the tree at the first 200 unrelated Time/Media/Keyword anchors.
import {readAllAnchorFeature} from '../model/feature-transaction-client.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../packages/zenstack/anchor-hierarchy.mjs';
import {sourceTaxonomyFromAnchors} from './classification.mjs';

const SOURCE_COLUMNS='uid,type,title,invisible,attr';
const EDITOR_COLUMNS='uid,type,title,description,invisible,attr,createtime,num';

export async function readPublicSourceAnchors({editor=false}={}){
  // Culture/Statistics remain public. Protected source-editing reads
  // use read_loc_source_hierarchy through its Admin query route instead.
  return readAllAnchorFeature({scope:'loc',family:'source',editor});
}

export async function readPublicSourceTaxonomy(){
  return sourceTaxonomyFromAnchors(await readPublicSourceAnchors());
}
