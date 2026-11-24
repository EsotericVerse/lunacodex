import {headers} from 'next/headers';

export async function invokeHandler(handler,{path,method='POST',body,options}={}){
  const incoming=await headers();
  const requestHeaders=new Headers();
  for(const key of ['cookie','origin','referer','authorization','content-type']){
    const value=incoming.get(key);
    if(value)requestHeaders.set(key,value);
  }
  if(body!==undefined)requestHeaders.set('content-type','application/json');
  const origin=incoming.get('origin')||'https://loc.local';
  const request=new Request(new URL(path,origin),{
    method,headers:requestHeaders,
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const response=await handler(request,process.env,options);
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(payload?.error?.message||payload?.error||
      'LOC request failed (HTTP '+response.status+')');
    error.status=response.status;
    error.code=payload?.code||payload?.error?.code;
    throw error;
  }
  return payload;
}
