import {verifiedLocWebsiteSession} from '../../app/loc/auth/verified-session.mjs';
import {locPermissionsForEmail} from '../../app/loc/permissions/roles.mjs';
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {createFixedLocClient} from '../../zenstack/client.mjs';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';

// One policy-enforced ZenStack reader per trusted database dialect/isolate.
const policyReaders=new WeakMap();

// A website authorization endpoint: read-only role lookup in the SAME Neon
// table as the business writer. LOC Auth does not compute or store role grants.
export async function onRequestGet({request,env}){
  const response=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
  try{
    const session=await verifiedLocWebsiteSession(request);
    const {db,dialect}=await directMcpKysely(env);
    // Web uses the fixed business ZModel and its PolicyPlugin. LOC Auth
    // supplies verified identity only; it owns no business role decisions.
    let policyClient=policyReaders.get(dialect);
    if(!policyClient){
      policyClient=createFixedLocClient({dialect}).$use(new PolicyPlugin());
      policyReaders.set(dialect,policyClient);
    }
    const result=await locPermissionsForEmail(db,session.email,{policyClient});
    return response({...result,email:session.email,subject:session.userId});
  }catch(error){
    const status=Number(error?.httpStatus)||503;
    return response({canWrite:false,canManage:false,grants:[],
      error:status>=500?'LOC permission service unavailable':
        'LOC permission denied',
      // Non-secret stage code (e.g. no_cookie, no_session) for diagnosis.
      reason:error?.reason||'unknown'},status);
  }
}
