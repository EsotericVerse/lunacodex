import {headers} from 'next/headers.js';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase} from '../mcp/native-kysely.mjs';
import {bindLocAuthorization} from '../providers/loc-authorization.mjs';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';
import {verifiedLocWebsiteSession} from '../auth/verified-session.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';

const activeScopes=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false)
  .map(row=>row.scope_id));

function requestFromNextHeaders(incoming){
  const requestHeaders=new Headers();
  const cookie=incoming.get('cookie');
  if(cookie)requestHeaders.set('cookie',cookie);
  return new Request('https://loc.lo3rwang.cc/_loc-internal-read',{
    headers:requestHeaders
  });
}

function hasReadGrant(grants,scope){
  return grants.includes('global:manage')||grants.includes(scope+':read')||
    grants.includes(scope+':write')||grants.includes(scope+':manage')||
    grants.includes('group:'+scope+':manage');
}
function hasWriteGrant(grants,scope){
  return grants.includes('global:manage')||grants.includes(scope+':write')||
    grants.includes(scope+':manage')||grants.includes('group:'+scope+':manage');
}

export async function withAuthorizedLocRead({scope,scopes=[],global=false,
  writeScopes=[],targetId=null},read,dependencies={}){
  const requested=[...new Set([scope,...scopes].filter(Boolean).map(String))];
  const writes=[...new Set(writeScopes.map(String))];
  if(requested.some(id=>!activeScopes.has(id))||
    writes.some(id=>!activeScopes.has(id)))
    throw Object.assign(new Error('LOC query Scope is not published'),{httpStatus:400});
  if(!global&&!requested.length)
    throw Object.assign(new Error('LOC read query requires an explicit Scope'),{httpStatus:400});

  const getHeaders=dependencies.getHeaders||headers;
  const verifySession=dependencies.verifySession||verifiedLocWebsiteSession;
  const openDatabase=dependencies.openDatabase||directMcpKysely;
  const closeDatabase=dependencies.closeDatabase||closeLocDatabase;
  const request=requestFromNextHeaders(await getHeaders());
  const session=await verifySession(request);
  const access=publishedLocAccess(session.email,{website:true});
  const grants=access.grants;
  const allowed=global
    ?grants.includes('global:manage')
    :requested.every(id=>hasReadGrant(grants,id))&&
      writes.every(id=>hasWriteGrant(grants,id));
  if(!allowed)throw Object.assign(new Error('LOC read permission required'),{httpStatus:403});

  const primary=targetId
    ?DATABASE_ACCESS_LIST.find(row=>row.backup_selected===true&&row.target_id===targetId)
    :DATABASE_ACCESS_LIST.find(row=>row.selected===true);
  if(!primary)throw Object.assign(new Error('LOC database unavailable'),{httpStatus:503});
  const port=await openDatabase(process.env,primary.target_id);
  try{
    bindLocAuthorization(port.db,{role:'authenticated',engine:port.engine,
      claims:{provider:'loc',role:'authenticated',sub:session.userId,
        email:session.email,me:true,grants}});
    return await read(port.db,port,{session,grants});
  }
  finally{await closeDatabase(port);}
}

export function assertLocReadGrant(grants,scope){
  if(!hasReadGrant(grants,String(scope||'')))
    throw Object.assign(new Error('LOC read permission required'),{httpStatus:403});
}

export function assertLocWriteGrant(grants,scope){
  if(!hasWriteGrant(grants,String(scope||'')))
    throw Object.assign(new Error('LOC write permission required'),{httpStatus:403});
}
