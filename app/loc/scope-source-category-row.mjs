'use client';
import {useAsyncResource} from './use-async-resource';
import {dbAuthClient,dbAuthRelation} from './db-client.mjs';

// One scope's raw category row (silver.<id>, filtered to id=<id>) is read,
// in slightly different shapes, by several editors/panels that commonly
// render together on the same management page (import panel, source
// correction, the classification editor, and the statistics taxonomy
// reader). Each used to run its own independent fetch under its own cache
// key, so opening a panel that mounts two or three of them at once issued
// the same row read two or three times. Sharing one canonical key here lets
// SWR serve every one of them from a single request when they're mounted
// together, and -- as a side effect -- keeps them all in sync after any one
// of them writes a save and refetches this key.
export function scopeSourceCategoryRowKey(id){
  return ['scope-source-category-row',id];
}
export function useScopeSourceCategoryRow(id,{enabled=true}={}){
  return useAsyncResource(scopeSourceCategoryRowKey(id),async()=>{
    if(id==='loc'){
      const {data,error}=await dbAuthRelation('silver.loc').select('DefaultArticleClass').eq('id','loc').maybeSingle();
      if(error)throw new Error(error.message);
      return {sourceNames:Array.isArray(data?.DefaultArticleClass)?data.DefaultArticleClass:[]};
    }
    const {data,error}=await dbAuthClient.schema('silver')
      .managedAction('read_source_catalog',{p_scope_id:id});
    if(error)throw new Error(error.message);
    const own=(data?.scopes||[]).find(row=>row.scopeid===id);
    if(!own)throw new Error('Scope source catalog unavailable');
    // From.title is the immutable Galaxy.site source comparison key.
    return {sourceNames:own.sources.map(row=>row.name)};
  },{enabled:enabled&&Boolean(id)});
}
