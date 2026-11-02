'use client';

import {dbPublicClient,dbAuthClient} from './db-client.mjs';
import {decodeLocCache,encodeLocCache} from './runtime-cache-fields.mjs';

const relation=client=>client.schema('silver').from('loc');
const COLUMNS='id,cache';
const runtimeRow=row=>({...row,...decodeLocCache(row?.cache)});

export async function readLocRuntimeConfig(){
  const {data,error}=await relation(dbPublicClient).select(COLUMNS).eq('id','loc').single();
  if(error)throw new Error(error.message||'系統設定讀取失敗');
  return runtimeRow(data);
}
export async function saveLocRuntimeConfig(fields){
  const allowed=['cache_mode','cache_provider','isr_domains','io_limits'];
  const changes=Object.fromEntries(Object.entries(fields||{}).filter(([key])=>allowed.includes(key)));
  if(!Object.keys(changes).length)throw new Error('沒有可儲存的系統設定');
  const {data:before,error:readError}=await relation(dbAuthClient)
    .select(COLUMNS).eq('id','loc').single();
  if(readError||!before)throw new Error(readError?.message||'系統設定讀取失敗，請檢查管理權限');
  const cache=encodeLocCache({...decodeLocCache(before.cache),...changes});
  const {data,error}=await relation(dbAuthClient)
    .update({cache})
    .eq('id','loc').select(COLUMNS).single();
  if(error||!data)throw new Error(error?.message||'系統設定儲存失敗，請檢查管理權限');
  return runtimeRow(data);
}
