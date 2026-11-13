import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {readLocAccess} from '../../app/loc/permissions/loc_access.mjs';
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';

// The website checks LOC Auth's Session, then reads one policy-enforced
// api.manage ZModel projection. No second role registry or query loop.
export async function onRequestGet({request,env}){
  const response=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
  try{
    const session=await verifiedLocWebsiteSession(request);
    const {db,dialect,engine}=await directMcpKysely(env);
    const result=await readLocAccess(db,session.email,{dialect,engine,website:true});
    return response({...result,email:session.email,subject:session.userId});
  }catch(error){
    const status=Number(error?.httpStatus)||503;
    return response({canWrite:false,canManage:false,grants:[],
      error:status>=500?'LOC permission service unavailable':
        'LOC permission denied',
      reason:error?.reason||'unknown'},status);
  }
}
