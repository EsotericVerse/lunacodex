// One FlexSearch format for both the Node backfill and Cloudflare Worker.
// CJK word segmentation is part of the index format: never mix an old
// non-CJK snapshot with CJK delta segments under one completeness marker.
import {Index,Charset} from 'flexsearch';

export const LOC_SEARCH_INDEX_FORMAT=2;
export const LOC_SEARCH_INDEX_PREFIX='loc-search/v2/';
export function createLocSearchIndex(){
  return new Index({tokenize:'full',encoder:Charset.CJK,resolution:3,cache:false});
}
