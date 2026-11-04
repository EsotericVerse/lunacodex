import {isUnifiedAnchorScope} from './unified-anchor-compat.mjs';
// Migrated Scopes use a compact numeric JSONB switch map.
export const isJsonbScope=id=>isUnifiedAnchorScope(id);
const authorFeatureNames=Object.freeze({
  search_able:'search',statistics_able:'statics',culture_able:'culture',trace:'trace'
});
export const scopeFeatureKeys=Object.freeze(Object.keys(authorFeatureNames));
export const scopeFeatureName=key=>authorFeatureNames[key]||'';
const fourFlagScopes=new Set(['lo3rwang','lrunes']);
export const scopeFeatureColumns=id=>id==='loc'?'':fourFlagScopes.has(id)
  ?'trace,search,culture,statics':isJsonbScope(id)?'able':'search_able,statistics_able,culture_able';
export const scopeConfigColumns=id=>id==='loc'?'id,display_name,locale':'id,display_name,search_intro,search_aliases,theme,locale'+(scopeFeatureColumns(id)?','+scopeFeatureColumns(id):'');
export function scopeFeatureEnabled(config,key){
  const name=scopeFeatureName(key);
  if(!name)return false;
  // Scope config is independent from Galaxy.attr; these are four booleans
  // on each Scope's own config row, not article permissions.
  if(fourFlagScopes.has(config?.id)){
    const raw=config[name];
    return raw===true||raw===1||raw==='1'||raw==='true';
  }
  const raw=config?.able?.[name];
  if(raw!==undefined&&raw!==null)return raw===1||raw===true;
  return config?.[key]!==false;
}
export function scopeFeaturePatch(id,config){
  if(id==='loc')return {};
  if(fourFlagScopes.has(id))return Object.fromEntries(scopeFeatureKeys.map(key=>[
    scopeFeatureName(key),scopeFeatureEnabled({...config,id},key)
  ]));
  if(isJsonbScope(id))return {able:Object.fromEntries(scopeFeatureKeys.map(key=>[
    scopeFeatureName(key),scopeFeatureEnabled(config,key)?1:0
  ]))};
  return Object.fromEntries(scopeFeatureKeys.filter(key=>key!=='trace')
    .map(key=>[key,scopeFeatureEnabled(config,key)]));
}
export const scopeTagColumn=id=>isJsonbScope(id)?'ArticleTag':String(id)==='lrunes'?'txt_class':'DefaultArticleClass';
export function scopeTagNames(id,row){
  const value=row?.[scopeTagColumn(id)];
  return Array.isArray(value)?value:[];
}
