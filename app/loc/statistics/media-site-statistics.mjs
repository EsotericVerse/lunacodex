// Media statistics use published SiteAnchor source lineage + Galaxy.site.
// Never infer a media record from Galaxy.media_link or an Anchor URL.
import {publishedSourceTaxonomy} from '../../modular/published-source-taxonomy.js';
import {sourceSiteKeyForLabel} from '../source/classification.mjs';

const normalize=s=>String(s||'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export function mediaSiteSources(taxonomy=publishedSourceTaxonomy()){
  return [...new Set((taxonomy?.categories||[])
    .filter(row=>row.root==='media'&&row.type==='from'&&row.enabled!==false)
    .map(row=>String(row.display_name||'').trim()).filter(Boolean))].sort();
}
export function mediaSiteDailyRows(rows=[],taxonomy=publishedSourceTaxonomy()){
  const allowed=new Set(mediaSiteSources(taxonomy).flatMap(name=>
    [normalize(name),sourceSiteKeyForLabel(name)]));
  return (Array.isArray(rows)?rows:[])
    .filter(row=>row?.kind==='source'&&allowed.has(normalize(row.category)))
    .map(row=>({day:String(row.day||'').slice(0,10),
      category:String(row.category||'').trim(),
      item_count:Number(row.item_count)||0}))
    .filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.day)&&row.item_count>0);
}
