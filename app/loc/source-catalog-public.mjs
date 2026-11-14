// Shared, typed SiteAnchor source reader. Both Admin and public
// Culture/Statistics use the *same* canonical source discriminator set.
// Pagination uses LOC's existing Kysely read helper: it must not silently
// truncate the tree at the first 200 unrelated Time/Media/Keyword anchors.
import {selectAllRows} from './db-query.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../zenstack/anchor-hierarchy.mjs';
import {sourceTaxonomyFromAnchors} from './source-classification.mjs';

const SOURCE_COLUMNS='uid,type,title,invisible,attr';
const EDITOR_COLUMNS='uid,type,title,description,invisible,attr,createtime,num';

export async function readPublicSourceAnchors({editor=false}={}){
  // Culture/Statistics remain public. Protected source-editing reads
  // use read_loc_source_hierarchy through the management gateway instead.
  const {rows}=await selectAllRows('silver.loc_anchor',{
    columns:editor?EDITOR_COLUMNS:SOURCE_COLUMNS,
    filters:[{column:'type',operator:'in',value:ANCHOR_TYPE_GROUPS.source}],
    orders:[{column:'uid',ascending:true}],
    pageSize:200
  });
  return rows;
}

export async function readPublicSourceTaxonomy(){
  return sourceTaxonomyFromAnchors(await readPublicSourceAnchors());
}
