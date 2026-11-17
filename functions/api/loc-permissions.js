import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {readLocAccess} from '../../app/loc/permissions/loc_access.mjs';
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';

// The website checks LOC Auth's Session, then reads one policy-enforced
// api.manage ZModel projection. No second role registry or query loop.
export async function onRequestGet({request,env,waitUntil}){
  const response=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
  try{
    const session=await verifiedLocWebsiteSession(request);
    const {db,dialect,engine}=await directMcpKysely(env,'',{waitUntil});
    const result=await readLocAccess(db,session.email,{dialect,engine,website:true});
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
  }
}
