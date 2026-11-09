// Fixed LOC ArticleTag categories. No Source Anchor hierarchy or editing.
export const classNames=values=>[...new Set((Array.isArray(values)?values:[]).map(x=>String(x??'').trim()).filter(Boolean))];
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export function sourceSiteKeyForLabel(value){
 const s=norm(value);return s==='其他'||s==='others'?'others':s.match(/[a-z][a-z0-9_-]{2,}$/)?.[0]||s;
}
export function sourceLabelMatchesSite(site,label){
 const a=norm(site),b=norm(label);
 return Boolean(a&&b&&(a===b||sourceSiteKeyForLabel(b)===a));
}
export function sourceTaxonomyFromArrays(tags=[]){
 const names=classNames(tags).filter(s=>!['others','其他'].includes(norm(s)));
 names.push('Others');
 return {categories:names.map(name=>({category_code:norm(name),display_name:name,enabled:true})),
  aliases:names.map(name=>({source_key:norm(name),category_code:norm(name)})),
  groups:[],groupAliases:[],tree:[]};
}
export const sourceTaxonomyFromCatalog=tags=>sourceTaxonomyFromArrays(tags);
