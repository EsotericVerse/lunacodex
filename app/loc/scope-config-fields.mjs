// The author's Scope uses a compact numeric JSONB switch map; all other Scopes
// keep their existing independent boolean columns.
export const isJsonbScope=id=>String(id)==='lo3rwang';
const authorFeatureNames=Object.freeze({
  search_able:'search',statistics_able:'statics',culture_able:'culture',trace:'trace'
});
export const scopeFeatureKeys=Object.freeze(Object.keys(authorFeatureNames));
export const scopeFeatureName=key=>authorFeatureNames[key]||'';
export const scopeFeatureColumns=id=>id==='loc'||id==='lrunes'?'':isJsonbScope(id)?'able':'search_able,statistics_able,culture_able';
export const scopeConfigColumns=id=>id==='loc'?'id,display_name,locale':'id,display_name,search_intro,search_aliases,theme,locale'+(scopeFeatureColumns(id)?','+scopeFeatureColumns(id):'');
export function scopeFeatureEnabled(config,key){
  const name=scopeFeatureName(key);
  if(!name)return false;
  // lrunes no longer has three Scope-level *_able columns; articles use Galaxy.able.
  if(config?.id==='lrunes')return true;
  const raw=config?.able?.[name];
  if(raw!==undefined&&raw!==null)return raw===1||raw===true;
  // The published route snapshot may lag an authorized configuration publish.
  return config?.[key]!==false;
}
export function scopeFeaturePatch(id,config){
  if(id==='loc'||id==='lrunes')return {};
  if(isJsonbScope(id)){
    return {able:Object.fromEntries(scopeFeatureKeys.map(key=>[
      scopeFeatureName(key),scopeFeatureEnabled(config,key)?1:0
    ]))};
  }
  return Object.fromEntries(scopeFeatureKeys.filter(key=>key!=='trace')
    .map(key=>[key,scopeFeatureEnabled(config,key)]));
}
export const scopeTagColumn=id=>isJsonbScope(id)?'ArticleTag':String(id)==='lrunes'?'txt_class':'DefaultArticleClass';
export function scopeTagNames(id,row){
  const value=row?.[scopeTagColumn(id)];
  return Array.isArray(value)?value:[];
}
