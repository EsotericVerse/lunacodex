// Browser -> signed LOC Authority. Group authorization stays server-side.
import {locAuthorityOrigin} from './authority-origin.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SUBJECT=/^loc_[A-Za-z0-9_-]{32,80}$/;
const ACTIONS=new Set(['read','write','manage','configure']);

export async function scopeGroupRequest({groupid,kind='list',scopeid,subject,actions,days=365,
  token,classUid,fetchImpl=globalThis.fetch}={}){
  if(!SCOPE.test(String(groupid||'')))throw Error('Invalid Group ID');
  if(typeof token!=='string'||!token.trim())throw Error('LOC Auth login required');
  let path='group/'+groupid+'/grants',method='GET',body;
  if(kind==='grant'){
    if(!SCOPE.test(String(scopeid||''))||!SUBJECT.test(String(subject||''))||
      !Array.isArray(actions)||!actions.length||actions.some(x=>!ACTIONS.has(x))||
      !Number.isInteger(days)||days<1||days>365)throw Error('Invalid Group authorization');
    path='group/'+groupid+'/grant';method='PUT';
    body={scope:scopeid,subject,actions,expires_at:Date.now()+days*86400000};
  }else if(kind==='revoke'){
    if(!SCOPE.test(String(scopeid||''))||!SUBJECT.test(String(subject||'')))
      throw Error('Invalid Group revocation');
    path='group/'+groupid+'/revoke';method='POST';body={scope:scopeid,subject};
  }else if(kind==='join'){
    if(!SCOPE.test(String(scopeid||''))||scopeid===groupid)
      throw Error('Invalid Group member');
    path='group/'+groupid+'/scope/'+scopeid;method='PUT';body={};
  }else if(kind==='categoryAdd'||kind==='categoryRemove'){
    if(!SCOPE.test(String(scopeid||''))||scopeid===groupid||
        !/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(classUid||'')))
      throw Error('Invalid keyword Category identifier');
    path='group/'+groupid+'/category';method=kind==='categoryAdd'?'PUT':'POST';
    body={scopeid,class_uid:classUid};
  }else if(kind!=='list')throw Error('Unknown Group action');
  const origin=await locAuthorityOrigin(fetchImpl);
  const res=await fetchImpl(origin+'/v1/mcp/'+path,{
    method,cache:'no-store',credentials:'omit',redirect:'manual',
    signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+token,accept:'application/json',
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(res.status===401)throw Error('LOC Auth login expired');
  if(res.status===403)throw Error('Scope Group management permission required');
  if(!res.ok)throw Error('Group Authority HTTP '+res.status);
  return res.json();
}
