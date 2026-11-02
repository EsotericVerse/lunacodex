'use client';
import {useAsyncResource} from './use-async-resource';
import {dbAuthRelation} from './db-client.mjs';
import {scopeTagColumn} from './scope-config-fields.mjs';

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
    const {data,error}=await dbAuthRelation('silver.'+id).select(scopeTagColumn(id)).eq('id',id).maybeSingle();
    if(error)throw new Error(error.message);
    return data;
  },{enabled:enabled&&Boolean(id)});
}
