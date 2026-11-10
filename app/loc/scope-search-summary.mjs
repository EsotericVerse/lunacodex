'use client';


import {dbAuthClient,dbPublicClient} from './db-client.mjs';

const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;

export function summaryScopeIds(values=[]){
  return [...new Set((Array.isArray(values)?values:[]).map(value=>String(value||'').trim().toLowerCase())
    .filter(value=>SCOPE_ID.test(value)&&!['loc','admin','local'].includes(value)))];
}

export function summarizeScopeSearchSummary(scopeIds,rows=[]){
  const ids=summaryScopeIds(scopeIds);
  if(!ids.length)return null;
  const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row?.scope_id||''),row]));
  if(ids.some(id=>!byId.has(id)))return null;
  let articleCount=0,wordCount=0,firstDate='',lastDate='';
  for(const id of ids){
    const row=byId.get(id);
    const articles=Number(row.article_count);
    const words=Number(row.word_count);
    if(!Number.isSafeInteger(articles)||articles<0||!Number.isSafeInteger(words)||words<0)return null;
    articleCount+=articles;
    wordCount+=words;
    const start=String(row.first_date||'').slice(0,10);
    const end=String(row.last_date||'').slice(0,10);
    if(start&&(!firstDate||start<firstDate))firstDate=start;
    if(end&&(!lastDate||end>lastDate))lastDate=end;
  }
  return {articleCount,wordCount,firstDate,lastDate};
}

export async function readScopeSearchSummary(scopeIds){
  const ids=summaryScopeIds(scopeIds);
  if(!ids.length)return {rows:[],summary:null};
  // Read the current server-side Kysely summary; never substitute a build-time
  // published snapshot when the SQL query fails or returns partial data.
  const result=await dbPublicClient.schema('silver').analytics({
    p_scope_id:'loc',p_view:'search_summary',p_options:{scopeIds:ids}
  });
  if(result?.error)throw Error(result.error.message||'LOC Search summary unavailable');
  const rows=Array.isArray(result?.data?.rows)?result.data.rows:[];
  return {rows,summary:summarizeScopeSearchSummary(ids,rows)};
}

export async function refreshScopeSearchSummary(scopeId){
  const ids=summaryScopeIds([scopeId]);
  if(ids.length!==1)throw new Error('Scope ID 格式無效');
  const {data,error}=await dbAuthClient.schema('silver')
    .managedAction('refresh_scope_search_summary',{p_scope_id:ids[0]});
  if(error)throw new Error(error.message||'統計更新失敗');
  if(String(data?.scope_id)!==ids[0]||!Number.isSafeInteger(Number(data?.article_count))){
    throw new Error('統計更新未回傳有效資料');
  }
  return data;
}
