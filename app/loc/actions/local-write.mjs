'use server';
import {headers} from 'next/headers.js';
import {handleNativeLocOperation} from '../mcp/native-operations.mjs';
import {isManagedReadAction,isManagedWriteAction}
  from './managed-query-routes.mjs';

// Ordinary website writes enter the same Next.js process that owns the page.
// The dedicated HTTP write endpoint is reserved for an explicitly enabled
// bulk-import window; small saves do not make a second browser HTTP hop.
export async function runLocalLocWrite(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    !['managed-write','managed-transaction','managed-action'].includes(body.kind)||
    body.kind==='managed-action'&&(!isManagedWriteAction(body.name,body.args)||
      isManagedReadAction(body.name,body.args)))
    throw Error('Only ordinary LOC writes can use the local write action');
  const incoming=await headers();
  const requestHeaders=new Headers({'content-type':'application/json'});
  const cookie=incoming.get('cookie');
  if(cookie)requestHeaders.set('cookie',cookie);
  const request=new Request('https://loc.lo3rwang.cc/_loc-internal-write',{
    method:'POST',headers:requestHeaders,body:JSON.stringify(body)
  });
  const response=await handleNativeLocOperation(request,process.env,
    {trustedLocalAction:true});
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(payload?.error?.message||'LOC write failed');
    error.status=response.status;
    error.code=payload?.error?.code;
    throw error;
  }
  return payload;
}
