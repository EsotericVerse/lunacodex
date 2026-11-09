'use client';
import {useAsyncResource} from './use-async-resource';
import {PUBLISHED_LOC_ARTICLE_TAGS} from '../modular/published-source-taxonomy.js';
export function useSourceCategories(){return useAsyncResource(['loc-article-tags'],async()=>({
 categories:PUBLISHED_LOC_ARTICLE_TAGS,aliases:[],groups:[]}));}
export function AdminSourceCategories(){return null;}
