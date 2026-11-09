// Scope-level availability flags are native PostgreSQL boolean columns.
const authorFeatureNames=Object.freeze({
  search:'search',statistics_able:'statics',culture_able:'culture',trace:'trace'
});
export const scopeFeatureKeys=Object.freeze(Object.keys(authorFeatureNames));
export const scopeFeatureName=key=>authorFeatureNames[key]||'';
export const isJsonbScope=()=>false;
export const scopeFeatureColumns=id=>id==='loc'?'':'search,statics,culture,trace';
export const scopeConfigColumns=id=>id==='loc'?'id,display_name,locale':'id,display_name,search_intro,search_aliases,theme,locale'+(scopeFeatureColumns(id)?','+scopeFeatureColumns(id):'');
export function scopeFeatureEnabled(config,key){
  const name=scopeFeatureName(key);
  if(!name)return false;
  const value=config?.[name];
  if(typeof value==='boolean')return value;
  return typeof config?.[key]==='boolean'?config[key]:true;
}
export function scopeFeaturePatch(id,config){
  if(id==='loc')return {};
  return Object.fromEntries(scopeFeatureKeys.map(key=>[
    scopeFeatureName(key),scopeFeatureEnabled(config,key)
  ]));
}
// Source names now come from Scope Anchor From nodes. LOC's system entries
// remain the explicitly managed group-level ArticleTag catalogue.
export function scopeSourceNames(row){
  const value=row?.sourceNames??row?.ArticleTag;
  return Array.isArray(value)?value:[];
}
