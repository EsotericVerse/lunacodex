'use client';

import {useCallback,useEffect} from 'react';
import {useQueryClient} from '../../zenstack/client-queries';
import {getAccountSession,dbAuthEvents,signInWithGoogle,signOutAccount} from './db-client.mjs';
import {readLocEditorGrants} from './auth/editor-grants.mjs';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';
import {readAuthorization,setAuthorization,clearAuthorization,createScopeAuthorizer} from './authorization-runtime.mjs';
import {defaultScopeData,scopeDataFromManageRows} from './scope-data';
import {useAsyncResource} from './use-async-resource';
import {shouldInvalidateManagementForAuthEvent} from './auth/account-event-guard.mjs';
import {enableWebPermissionSession,readWebPermissionSession,clearWebPermissionSession} from './permissions/web-session.mjs';

const normalizeAuthEmail=value=>String(value||'').trim().toLowerCase();
const normalizeScopeId=value=>String(value||'').trim().toLowerCase();

// One shared resource per identity level for the current browser runtime.
// Public navigation observes Auth state without initiating a session or
// management query. Only protected views opt into management authorization. A permission result is UI state, never a substitute for
// LOC delegated SQL write authorization.
const SESSION_KEY=['loc-account','session'];
const VERIFIED_SESSION_KEY=['loc-account','verified-google-oauth'];
const MANAGEMENT_KEY=['loc-account','management'];
// A management workspace verifies LOC Auth once on entry. Never re-query on
// focus or stale expiry; protected writes still verify server authorization.
const emptyState=Object.freeze({
  loading:true,user:null,email:'',role:'',authorizer:null,
  permissionLoading:true,error:'',scopes:[]
});
const signedOutState=Object.freeze({...emptyState,loading:false,permissionLoading:false});

function failedState(error){
  return {...signedOutState,error:String(error?.message||error)};
}

async function loadSessionAccount(){
  try{
    const session=await getAccountSession();
    const user=session?.user||null;
    if(!user)return signedOutState;
    return {...signedOutState,user,email:session.oauth.email,oauth:session.oauth};
  }catch(error){
    return failedState(error);
  }
}

let authRevision=0;
let authUserId='';
let authEmail='';

let scopeMetadata=[];
// Concurrent verification is shared; completed grants can be reused during
// navigation within the same verified identity. Explicit refresh stays live.
let pendingManagementVerification=null;

async function fetchManagementAccount(queryClient,{force=false}={}){
  const startedAt=authRevision;
  const obsolete=()=>startedAt!==authRevision;
  let verifiedIdentity=null;
  try{
    // Clicked edit entry: first check the LOC Auth session. A signed-out
    // visitor must never issue a management/SQL request.
    const session=await getAccountSession();
    const user=session?.user||null;
    if(obsolete())return signedOutState;
    if(!user){
      clearAuthorization();
      scopeMetadata=[];
      authUserId='';
      authEmail='';
      queryClient.setQueryData(SESSION_KEY,signedOutState);
      return signedOutState;
    }
    // LOC Auth owns signed Scope grants independently of the SQL connection.
    // One self-delegation request is performed only on explicit edit entry.
    verifiedIdentity={user,email:normalizeAuthEmail(session.oauth?.email||user.email),oauth:session.oauth};
    // The Web permission Session is separate from LOC Auth's login Session.
    // Reuse it for navigation only; a fresh edit entry (force) checks the
    // server again and every write retains its server-side ACL check.
    const webStorage=typeof window==='undefined'?null:window.sessionStorage;
    const cached=!force?readWebPermissionSession(webStorage,user):null;
    const permissions=cached||await readLocEditorGrants(session,{
      authorityOrigin:process.env.NEXT_PUBLIC_LOC_CONTROL_URL||'https://auth.lo3rwang.cc',
      scopeKinds:Object.fromEntries(SCOPE_ROUTE_INDEX.map(row=>[row.scope_id,row.scope_kind]))
    });
    if(obsolete())return signedOutState;
    const metadata=scopeDataFromManageRows(permissions);
    setAuthorization(user,permissions);
    scopeMetadata=metadata;
    authUserId=String(user.id);
    authEmail=normalizeAuthEmail(user.email);
    const authorizer=createScopeAuthorizer(user);
    if(authorizer&&!cached)enableWebPermissionSession(webStorage,user,permissions);
    return authorizer?{...signedOutState,...verifiedIdentity,
      role:authorizer.role,authorizer,scopes:metadata}:signedOutState;
  }catch(error){
    // An older request must not erase a newer account's verified grants.
    if(obsolete())return signedOutState;
    // Never accept a previous local grant as proof of a failed live check.
    // Preserve the verified identity for retry but deny editor access.
    clearAuthorization();
    scopeMetadata=[];
    authUserId='';
    authEmail='';
    if(typeof window!=='undefined')clearWebPermissionSession(window.sessionStorage);
    return verifiedIdentity
      ?{...signedOutState,...verifiedIdentity,error:String(error?.message||error)}
      :failedState(error);
  }
}

// Passive management consumers reuse the grant already verified for this
// identity. An explicit editor entry still forces a live LOC Auth Scope check.
// Each write must be reauthorized by the trusted application backend.
function loadManagementAccount(queryClient,{force=false}={}){
  if(!force){
    const verified=readVerifiedManagementEntry();
    if(verified)return Promise.resolve({
      ...signedOutState,user:verified.user,email:authEmail,
      role:verified.authorizer.role,authorizer:verified.authorizer,
      scopes:scopeMetadata
    });
  }
  if(pendingManagementVerification)return pendingManagementVerification;
  const current=fetchManagementAccount(queryClient,{force});
  pendingManagementVerification=current;
  void current.then(
    ()=>{if(pendingManagementVerification===current)pendingManagementVerification=null;},
    ()=>{if(pendingManagementVerification===current)pendingManagementVerification=null;}
  );
  return current;
}

// Reuse the previously verified identity/role on management page navigation.
// Auth changes clear this grant; database writes still enforce server permission.
export function readVerifiedManagementEntry(){
  const grant=readAuthorization();
  if(!grant||!authUserId||grant.userId!==authUserId||grant.email!==authEmail)return null;
  if(typeof window!=='undefined'&&!readWebPermissionSession(
    window.sessionStorage,{id:authUserId,email:authEmail}))return null;
  const user={id:grant.userId,email:grant.email};
  const authorizer=createScopeAuthorizer(user);
  return authorizer?{user,authorizer}:null;
}

export function useAccount({enabled=true,sessionOnly=false}={}){
  const queryClient=useQueryClient();
  const queryKey=sessionOnly?(enabled?VERIFIED_SESSION_KEY:SESSION_KEY):MANAGEMENT_KEY;
  const queryFn=useCallback(
    ()=>sessionOnly?loadSessionAccount():loadManagementAccount(queryClient),
    [sessionOnly,queryClient]
  );
  // Passive identity must subscribe to auth-event cache updates without making
  // a session/network request. A passive query subscribes to auth-event updates
  // while remaining disabled for network fetches.
  const passive=sessionOnly&&!enabled;
  const query=useAsyncResource(queryKey,passive?null:queryFn,{
    enabled:enabled||passive,
    revalidateOnFocus:false,
    revalidateOnReconnect:false,
    revalidateIfStale:false,
    ...(passive?{fallbackData:signedOutState}:{}),
  });
  const state=query.data||emptyState;
  // A failed network read is not a sign-out. Retry only when the browser
  // reconnects or the user returns to a tab that failed verification.
  useEffect(()=>{
    if(!sessionOnly||!enabled||
      !/Failed to fetch|連線失敗|NetworkError|Load failed/i.test(String(state.error||'')))
      return undefined;
    const recheck=()=>{void query.mutate().catch(()=>{});};
    const onVisible=()=>{if(document.visibilityState==='visible')recheck();};
    window.addEventListener('online',recheck);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      window.removeEventListener('online',recheck);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[sessionOnly,enabled,state.error,query.mutate]);

  // Explicit edit entry rechecks LOC Auth; normal mounts reuse the
  // in-memory grant and never query a management table.
  const refresh=useCallback(async()=>{
    const fetcher=sessionOnly?queryFn:()=>loadManagementAccount(queryClient,{force:true});
    await queryClient.cancelQueries({queryKey,exact:true});
    const result=await fetcher();
    queryClient.setQueryData(queryKey,result);
    if(result?.error)throw new Error(result.error);
    if(sessionOnly)return result?.user||null;
    return result?.user&&result.authorizer
      ?{user:result.user,authorizer:result.authorizer}:null;
  },[queryClient,queryKey,queryFn,sessionOnly]);

  const signIn=useCallback(callbackURL=>signInWithGoogle(String(callbackURL||'').trim()),[]);
  const signOut=useCallback(async()=>{
    await signOutAccount();
    authRevision+=1;
    authUserId='';
    authEmail='';
    clearAuthorization();
    scopeMetadata=[];
    pendingManagementVerification=null;
    if(typeof window!=='undefined')clearWebPermissionSession(window.sessionStorage);
    await queryClient.cancelQueries({queryKey:['loc-account']});
    queryClient.setQueryData(SESSION_KEY,signedOutState);
    queryClient.setQueryData(VERIFIED_SESSION_KEY,signedOutState);
    queryClient.setQueryData(MANAGEMENT_KEY,signedOutState);
  },[queryClient]);

  // The hidden local Scope is device-only and has no cloud management row.
  const canManageScopeSync=useCallback(
    scopeId=>normalizeScopeId(scopeId)==='local'||Boolean(state.authorizer?.canManageScopeSync(scopeId)),
    [state.authorizer]
  );
  const canManageGroupSync=useCallback(
    groupId=>Boolean(state.authorizer?.canManageGroupSync(groupId)),
    [state.authorizer]
  );
  const canManageGlobalSync=useCallback(
    ()=>Boolean(state.authorizer?.canManageGlobalSync()),
    [state.authorizer]
  );
  const scopeDataFor=useCallback(scopeId=>{
    const id=normalizeScopeId(scopeId);
    if(id==='local')return defaultScopeData('local');
    return state.scopes.find(scope=>scope.id===id)
      ||(state.authorizer?.canManageGlobalSync()?defaultScopeData(id):null);
  },[state.authorizer,state.scopes]);

  return {
    ...state,refresh,signIn,signOut,
    canManageScopeSync,canManageGroupSync,canManageGlobalSync,scopeDataFor
  };
}

// Listen to the SDK's existing Auth event stream. Public pages never call
// getSession() or query silver.loc just to resolve navigation/UI state.
// OAuth and management entries still use the explicit authorization path.
export function usePassiveSessionAccount(){
  const account=useAccount({enabled:false,sessionOnly:true});
  const queryClient=useQueryClient();
  useEffect(()=>{
    const listener=dbAuthEvents.onAuthStateChange((event,session)=>{
      const user=session?.user||null;
      const nextUserId=String(user?.id||'');
      const nextEmail=normalizeAuthEmail(user?.email);
      // On a fresh static management page the verified LOC Auth session can
      // arrive while the management RPC is still in flight. Hydration is
      // NOT a sign-out or replacement of an existing authorized identity.
      const invalidate=shouldInvalidateManagementForAuthEvent({
        event,previousUserId:authUserId,previousEmail:authEmail,
        nextUserId,nextEmail,hasAuthorization:Boolean(readAuthorization())
      });
      if(invalidate){
        authRevision+=1;
        pendingManagementVerification=null;
        clearAuthorization();
        scopeMetadata=[];
        if(typeof window!=='undefined')clearWebPermissionSession(window.sessionStorage);
      }
      authUserId=nextUserId;
      authEmail=nextEmail;
      // Passive navigation needs only a session ID hint, never an OAuth email.
      // Google provider email is displayed only after Auth.getUser() verifies it.
      queryClient.setQueryData(SESSION_KEY,nextUserId
        ?{...signedOutState,user:{id:nextUserId}}
        :signedOutState);
      if(invalidate){
        // Never put an unverified SDK event user into the verified OAuth cache.
        queryClient.setQueryData(VERIFIED_SESSION_KEY,signedOutState);
        if(user)void queryClient.invalidateQueries({queryKey:VERIFIED_SESSION_KEY,exact:true});
        // Real sign-out or account replacement revokes old management grants.
        // Do not invalidate the active RPC on INITIAL_SESSION hydration.
        queryClient.setQueryData(MANAGEMENT_KEY,signedOutState);
      }
    });
    return ()=>listener.data.subscription.unsubscribe();
  },[queryClient]);
  return account;
}
