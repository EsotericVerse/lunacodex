'use client';

import {useCallback,useEffect} from 'react';
import {useQueryClient} from '../../zenstack/client-queries';
import {getAccountSession,dbAuthEvents,signInWithLocSso,signOutAccount} from './db-client.mjs';
import {readLocEditorGrants} from './auth/editor-grants.mjs';
import {readAuthorization,setAuthorization,clearAuthorization,createScopeAuthorizer} from './authorization-runtime.mjs';
import {defaultScopeData,scopeDataFromManageRows} from './scope-data';
import {useAsyncResource} from '../../zenstack/client-queries';
import {shouldInvalidateManagementForAuthEvent} from './auth/account-event-guard.mjs';

const normalizeAuthEmail=value=>String(value||'').trim().toLowerCase();
const normalizeScopeId=value=>String(value||'').trim().toLowerCase();

// One shared resource per identity level for the current browser runtime.
// Public navigation observes Auth state without initiating a session or
// management query. Only protected views opt into management authorization. A permission result is UI state, never a substitute for
// LOC delegated SQL write authorization.
const SESSION_KEY=['loc-account','session'];
const VERIFIED_SESSION_KEY=['loc-account','verified-loc-sso'];
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

async function fetchManagementAccount(queryClient){
  const startedAt=authRevision;
  const obsolete=()=>startedAt!==authRevision;
  let verifiedIdentity=null;
  try{
    // One protected request: the Web endpoint validates Better Auth Session
    // and ZModel/PolicyPlugin api.manage roles together. No preliminary
    // browser getSession(), no duplicate Auth round trip, no independent ACL.
    const permissions=await readLocEditorGrants();
    if(obsolete())return signedOutState;
    const user=permissions.user;
    verifiedIdentity={user,email:normalizeAuthEmail(user.email)};
    // UI scope metadata derives from the single validated ZModel role
    // projection, never from the raw HTTP response.
    setAuthorization(user,permissions);
    const metadata=scopeDataFromManageRows(
      (readAuthorization()?.entries||[]).map(({scopeid,role})=>
        ({id:scopeid,manage_role:role}))
    );
    scopeMetadata=metadata;
    authUserId=String(user.id);
    authEmail=normalizeAuthEmail(user.email);
    const authorizer=createScopeAuthorizer(user);
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
    // A 401 is authoritative sign-out from Better Auth's own session
    // verifier. Only a genuine missing Session clears passive identity;
    // transient 503/429 must not be presented as a successful sign-out.
    if(error?.status===401){
      queryClient.setQueryData(SESSION_KEY,signedOutState);
      queryClient.setQueryData(VERIFIED_SESSION_KEY,signedOutState);
    }
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
  const current=fetchManagementAccount(queryClient);
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
  // Failed Auth reads remain failed until the user explicitly retries
  // verification, signs in, or a real Auth SDK event updates the identity.
  // Tab visibility and network reconnect never trigger hidden Auth requests.

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

  const signIn=useCallback(callbackURL=>signInWithLocSso(String(callbackURL||'').trim()),[]);
  const signOut=useCallback(async()=>{
    await signOutAccount();
    authRevision+=1;
    authUserId='';
    authEmail='';
    clearAuthorization();
    scopeMetadata=[];
    pendingManagementVerification=null;
    await queryClient.cancelQueries({queryKey:['loc-account']});
    queryClient.setQueryData(SESSION_KEY,signedOutState);
    queryClient.setQueryData(VERIFIED_SESSION_KEY,signedOutState);
    queryClient.setQueryData(MANAGEMENT_KEY,signedOutState);
  },[queryClient]);

  // One in-memory role predicate after the explicit permissions lookup.
  const canLocAccessSync=useCallback((level,scopeId='')=>
    (level==='scope'&&normalizeScopeId(scopeId)==='local')||
    Boolean(state.authorizer?.canLocAccessSync(level,scopeId)),
    [state.authorizer]
  );
  const scopeDataFor=useCallback(scopeId=>{
    const id=normalizeScopeId(scopeId);
    if(id==='local')return defaultScopeData('local');
    return state.scopes.find(scope=>scope.id===id)
      ||(state.authorizer?.canLocAccessSync('global')?defaultScopeData(id):null);
  },[state.authorizer,state.scopes]);

  return {
    ...state,refresh,signIn,signOut,
    canLocAccessSync,scopeDataFor
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
      // Better Auth's adapter emits an empty INITIAL_SESSION to each
      // subscriber. This is hydration, not a sign-out; do not clobber
      // verified ZModel grants or identity hints on component remount.
      if(event==='INITIAL_SESSION'&&!nextUserId&&!nextEmail)return;
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
      }
      authUserId=nextUserId;
      authEmail=nextEmail;
      // Passive navigation needs only a session ID hint, never an OAuth email.
      // Cloudflare SSO email is displayed only after Auth.getUser() verifies it.
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
