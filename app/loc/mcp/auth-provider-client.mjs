// Browser root-admin configuration: sends credentials directly to Authority.
// Never persist secrets in browser storage, URLs, logs or Galaxy.
import {locAuthorityOrigin} from './authority-origin.mjs';
import {mcpLocSession} from './loc-access.mjs';
import {AUTH_PROVIDER_TYPES} from '../auth/auth-provider-settings.mjs';
export async function authProviderSettingsRequest({type='',values,fetchImpl=globalThis.fetch}={}){
  if(type&&!AUTH_PROVIDER_TYPES.includes(type))throw new Error('Invalid identity provider');
  if(values!==undefined&&!type)throw new Error('Identity provider must be selected');
  const identity=await mcpLocSession();
  if(!identity?.token)throw new Error('LOC Auth administrator login required');
  const authority=await locAuthorityOrigin(fetchImpl);
  const endpoint=authority+'/v1/auth/providers'+(type?'/'+type:'');
  const response=await fetchImpl(endpoint,{
    method:values===undefined?'GET':'PUT',cache:'no-store',
    credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{authorization:'Bearer '+identity.token,accept:'application/json',
      ...(values!==undefined?{'content-type':'application/json'}:{})},
    ...(values!==undefined?{body:JSON.stringify(values)}:{})
  });
  if(response.status===401)throw new Error('LOC Auth 登入已失效，請重新登入。');
  if(response.status===403)throw new Error('只有 LOC Recovery 管理員能設定認證來源。');
  if(!response.ok){
    const error=await response.json().catch(()=>({}));
    throw new Error(String(error?.error||'LOC 認證設定服務無法讀取（HTTP '+response.status+'）'));
  }
  return response.json();
}
