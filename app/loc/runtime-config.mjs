'use client';

import {dbAuthClient} from './db-client.mjs';
import {decodeLocCache} from './runtime-cache-fields.mjs';

// Administration settings live in api.manage. The existing protected
// managed action owns this read/write; anonymous public SQL never sees it.
const action=(operation,value)=>dbAuthClient.schema('silver').managedAction('loc_admin_settings',{
  p_section:'runtime',p_operation:operation,
  ...(operation==='update'?{p_value:value}:{})
});
const runtimeRow=caches=>({id:'admin',caches,...decodeLocCache(caches)});

export async function readLocRuntimeConfig(){
  const {data,error}=await action('read');
  if(error||!data||typeof data!=='object')
    throw new Error(error?.message||'系統設定讀取失敗');
  return runtimeRow(data);
}
export async function saveLocRuntimeConfig(fields){
  const allowed=['cache_mode','cache_provider','isr_domains','io_limits'];
  const changes=Object.fromEntries(Object.entries(fields||{}).filter(([key])=>allowed.includes(key)));
  if(!Object.keys(changes).length)throw new Error('沒有可儲存的系統設定');
  // The backend merges and validates the patch in one authorized transaction.
  const {data,error}=await action('update',changes);
  if(error||!data||typeof data!=='object')
    throw new Error(error?.message||'系統設定儲存失敗，請檢查管理權限');
  return runtimeRow(data);
}
