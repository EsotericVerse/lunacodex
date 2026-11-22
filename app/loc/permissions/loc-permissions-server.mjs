// Optional self-only management projection. Never a public role directory.
// Verified Auth Session gives identity; published JS Manage gives grants.
// No SQL access or independent permission database request.
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {publishedLocAccess} from './loc-business-grants.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8',
  'cache-control':'private, no-store','vary':'Cookie',
  'x-content-type-options':'nosniff'};
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
export async function handleLocSelfPermissions(request,{
  verifySession=verifiedLocWebsiteSession
}={}){
  if(request.method!=='POST')return respond({error:'POST required'},405);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)
    return respond({error:'Cross-origin request denied'},403);
  const raw=await request.text().catch(()=>null);
  let body=null;
  if(raw!==null&&raw.length<=100){try{body=JSON.parse(raw)}catch{}}
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).length!==1||body.operation!=='self')
    return respond({error:'Invalid LOC permission operation'},400);
  let session;
  try{session=await verifySession(request)}
  catch(error){return respond({error:'LOC Session unavailable'},error.httpStatus||503)}
  const rights=publishedLocAccess(session.email,{website:true});
  return respond({roles:rights.roles,grants:rights.grants,
    canWrite:rights.canWrite,canManage:rights.canManage});
}
