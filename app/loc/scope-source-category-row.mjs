'use client';
import {useAsyncResource} from './use-async-resource';
import {PUBLISHED_LOC_ARTICLE_TAGS} from '../modular/published-source-taxonomy.js';
export const scopeSourceCategoryRowKey=()=>['loc-article-tags'];
export function useScopeSourceCategoryRow(_id,{enabled=true}={}){
 return useAsyncResource(scopeSourceCategoryRowKey(),async()=>({sourceNames:[...PUBLISHED_LOC_ARTICLE_TAGS]}),{enabled});
}
