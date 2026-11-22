import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {readLocAccess,publishedLocAccess} from '../../app/loc/permissions/loc_access.mjs';
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../../app/loc/mcp/native-kysely.mjs';

// A verified LOC Auth identity uses the published JS role registry first.
// A known identity never opens Neon just to check management permission.
export async function onRequestGet({request,env,waitUntil}){
  const response=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
  let port=null;
  let releaseAbort=()=>{};
  try{
    const session=await verifiedLocWebsiteSession(request);
    const published=publishedLocAccess(session.email,{website:true});
    if(published.found)
      return response({...published.rights,email:session.email,subject:session.userId});
    // Only an identity not represented in published JS can reach SQL.
    port=await directMcpKysely(env,'',{waitUntil});
    releaseAbort=bindLocRequestAbort(port,request.signal);
    const result=await readLocAccess(port.db,session.email,{
      dialect:port.dialect,engine:port.engine,website:true});
    return response({...result,email:session.email,subject:session.userId});
  }catch(error){
    const status=[401,403,429,502,503].includes(Number(error?.httpStatus))
      ?Number(error.httpStatus):503;
    const message=status===401?'LOC authentication required'
      :status===403?'LOC permission denied'
      :status===429?'LOC permission verification rate limited'
      :'LOC permission service unavailable';
    // Preserve the HTTP distinction; a failed verifier is not a sign-out and
    // is never cached as a successful permission result.
    return response({canWrite:false,canManage:false,grants:[],
      error:message,reason:error?.reason||'unknown'},status);
  }finally{
    releaseAbort();
    try{await closeLocDatabase(port);}
    catch(error){console.error('[LOC permission SQL cleanup]',{code:String(error?.code||'CLOSE_FAILED').slice(0,64)});}
  }
}
