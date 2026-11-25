import {headers} from 'next/headers.js';
import {withOptionalGalaxy} from '../runtime/optional-galaxy.mjs';
import {publishedScopeAllowed} from '../permissions/public-feature-policy.mjs';
import {isDataUnavailable,standaloneResult} from '../runtime/r2-runtime.mjs';
import {DATABASE_ACCESS_LIST} from '../providers/access.js';
import {directMcpKysely,closeLocDatabase} from '../db/native-kysely.mjs';
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
  writeScopes=[],targetId=null,onUnavailable=null},read,dependencies={}){
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
  let port=null;
  try{
    port=await openDatabase(process.env,primary.target_id);
    bindLocAuthorization(port.db,{role:'authenticated',engine:port.engine,
      claims:{provider:'loc',role:'authenticated',sub:session.userId,
        email:session.email,me:true,grants}});
    return await read(port.db,port,{session,grants});
  }catch(error){
    if(!targetId&&!writes.length&&onUnavailable&&isDataUnavailable(error)){
      console.warn('LOC authorized read unavailable',error.code||'backend');
      return standaloneResult(await onUnavailable({session,grants}));
    }
    throw error;
  }
  finally{if(port)await closeDatabase(port);}
}

// Public feature readers use their own fixed projections and filters. This
// connection helper deliberately accepts no SQL, table, columns or query
// options from the caller; it does not create a public query endpoint.
export async function withPublicLocRead({scope,scopes=[],targetId=null,onUnavailable=null,onMissingGalaxy=null},read,
  dependencies={}){
  const requested=[...new Set([scope,...scopes].filter(Boolean).map(String))];
  if(!requested.length||requested.some(id=>!publishedScopeAllowed(id)))
    throw Object.assign(new Error('LOC public read requires a published Scope'),
      {httpStatus:400});
  // Bindings for public Server Action reads must resolve against the incoming
  // request context. Access a Next dynamic API before opening Hyperdrive; an
  // anonymous read must never use build-time/empty context for its DB binding.
  const getHeaders=dependencies.getHeaders||headers;
  await getHeaders();
  const openDatabase=dependencies.openDatabase||directMcpKysely;
  const closeDatabase=dependencies.closeDatabase||closeLocDatabase;
  const primary=targetId
    ?DATABASE_ACCESS_LIST.find(row=>row.backup_selected===true&&row.target_id===targetId)
    :DATABASE_ACCESS_LIST.find(row=>row.selected===true);
  if(!primary)throw Object.assign(new Error('LOC database unavailable'),{httpStatus:503});
  let port=null;
  try{
    port=await openDatabase(process.env,primary.target_id);
    bindLocAuthorization(port.db,{role:'anon',engine:port.engine,claims:{}});
    const run=()=>read(port.db,port,{session:null,grants:[],scopes:requested});
    return !targetId&&onMissingGalaxy&&requested.length===1
      ?await withOptionalGalaxy(port.db,requested[0],run,onMissingGalaxy,{engine:port.engine,namespace:port.namespace}):await run();
  }catch(error){
    if(!targetId&&onUnavailable&&isDataUnavailable(error)){
      console.warn('LOC public read unavailable',error.code||'backend');
      return standaloneResult(await onUnavailable());
    }
    throw error;
  }
  finally{if(port)await closeDatabase(port);}
}

export function assertLocReadGrant(grants,scope){
  if(!hasReadGrant(grants,String(scope||'')))
    throw Object.assign(new Error('LOC read permission required'),{httpStatus:403});
}

export function assertLocWriteGrant(grants,scope){
  if(!hasWriteGrant(grants,String(scope||'')))
    throw Object.assign(new Error('LOC write permission required'),{httpStatus:403});
}
