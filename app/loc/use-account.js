'use client';

import {useCallback,useEffect} from 'react';
import {useSWRConfig} from 'swr';
import {getAccountSession,dbAuthEvents,dbAuthClient,signInWithGoogle,signOutAccount} from './db-client.mjs';
import {readAuthorization,setAuthorization,clearAuthorization,createScopeAuthorizer} from './authorization-runtime.mjs';
import {defaultScopeData,scopeDataFromManageRows} from './scope-data';
import {useAsyncResource} from './use-async-resource';
import {shouldInvalidateManagementForAuthEvent} from './auth/account-event-guard.mjs';

const normalizeAuthEmail=value=>String(value||'').trim().toLowerCase();
const normalizeScopeId=value=>String(value||'').trim().toLowerCase();

// One shared resource per identity level for the current browser runtime.
// Public navigation observes Auth state without initiating a session or
// management query. Only protected views opt into management authorization. A permission result is UI state, never a substitute for
// LOC delegated SQL write authorization.
const SESSION_KEY=['loc-account','session'];
const VERIFIED_SESSION_KEY=['loc-account','verified-google-oauth'];
const MANAGEMENT_KEY=['loc-account','management'];
// A management workspace verifies once on entry. Never re-query on focus or
// stale-time expiry; explicit refresh and database write authorization remain.
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

async function fetchManagementAccount(mutate){
  const startedAt=authRevision;
  const obsolete=()=>startedAt!==authRevision;
  let verifiedIdentity=null;
  try{
    // Both endpoints independently verify the current signed LOC Auth token.
    // Start them together instead of spending an extra network round trip
    // between Authority identity and the protected Scope permissions RPC.
    const [sessionRead,permissionRead]=await Promise.allSettled([
      getAccountSession(),
      dbAuthClient.schema('silver').managedAction('manage',{p_type:'self'})
    ]);
    if(sessionRead.status==='rejected')throw sessionRead.reason;
    const session=sessionRead.value;
    const user=session?.user||null;
    if(obsolete())return signedOutState;
    if(!user){
      clearAuthorization();
      scopeMetadata=[];
      authUserId='';
      authEmail='';
      void mutate(SESSION_KEY,signedOutState,{revalidate:false});
      return signedOutState;
    }
    // Only grant editor access AFTER BOTH independent checks succeed.
    verifiedIdentity={user,email:normalizeAuthEmail(session.oauth?.email||user.email),oauth:session.oauth};
    if(permissionRead.status==='rejected')throw permissionRead.reason;
    const {data,error}=permissionRead.value;
    if(error)throw new Error(error.message||'Management permission read failed');
    if(obsolete())return signedOutState;
    const permissions=Array.isArray(data)?data:[];
    const metadata=scopeDataFromManageRows(permissions);
    setAuthorization(user,permissions);
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
    return verifiedIdentity
      ?{...signedOutState,...verifiedIdentity,error:String(error?.message||error)}
      :failedState(error);
  }
}

// Passive management consumers reuse the grant already verified for this
// identity. An explicit editor entry still forces a live LOC Auth + Scope check.
// Server RLS / RPC authorization independently protects every write.
function loadManagementAccount(mutate,{force=false}={}){
  if(!force){
    const verified=readVerifiedManagementEntry();
    if(verified)return Promise.resolve({
      ...signedOutState,user:verified.user,email:authEmail,
      role:verified.authorizer.role,authorizer:verified.authorizer,
      scopes:scopeMetadata
    });
  }
  if(pendingManagementVerification)return pendingManagementVerification;
  const current=fetchManagementAccount(mutate);
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
  const {mutate}=useSWRConfig();
  const queryKey=sessionOnly?(enabled?VERIFIED_SESSION_KEY:SESSION_KEY):MANAGEMENT_KEY;
  const queryFn=useCallback(
    ()=>sessionOnly?loadSessionAccount():loadManagementAccount(mutate),
    [sessionOnly,mutate]
  );
  // Passive identity must subscribe to auth-event cache updates without making
  // a session/network request. A null SWR key unsubscribes and leaves Settings
  // permanently stuck in emptyState.loading=true.
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

  // Explicit edit entry must re-verify; normal component mounts reuse
  // the in-memory grant and never send another manage(self) query.
  const refresh=useCallback(async()=>{
    const fetcher=sessionOnly?queryFn:()=>loadManagementAccount(mutate,{force:true});
    const result=await mutate(queryKey,fetcher,{revalidate:false});
    if(result?.error)throw new Error(result.error);
    if(sessionOnly)return result?.user||null;
    return result?.user&&result.authorizer
      ?{user:result.user,authorizer:result.authorizer}:null;
  },[mutate,queryKey,queryFn,sessionOnly]);

  const signIn=useCallback(callbackURL=>signInWithGoogle(String(callbackURL||'').trim()),[]);
  const signOut=useCallback(async()=>{
    await signOutAccount();
    authRevision+=1;
    authUserId='';
    authEmail='';
    clearAuthorization();
    scopeMetadata=[];
    pendingManagementVerification=null;
    await Promise.all([
      mutate(SESSION_KEY,signedOutState,{revalidate:false}),
      mutate(VERIFIED_SESSION_KEY,signedOutState,{revalidate:false}),
      mutate(MANAGEMENT_KEY,signedOutState,{revalidate:false})
    ]);
  },[mutate]);

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
  const {mutate}=useSWRConfig();
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
              }
      authUserId=nextUserId;
      authEmail=nextEmail;
      // Passive navigation needs only a session ID hint, never an OAuth email.
      // Google provider email is displayed only after Auth.getUser() verifies it.
      void mutate(SESSION_KEY,nextUserId
        ?{...signedOutState,user:{id:nextUserId}}
        :signedOutState,{revalidate:false});
      if(invalidate){
        // Never put an unverified SDK event user into the verified OAuth cache.
        void mutate(VERIFIED_SESSION_KEY,undefined,{revalidate:Boolean(user)});
        // Real sign-out or account replacement revokes old management grants.
        // Do not invalidate the active RPC on INITIAL_SESSION hydration.
        void mutate(MANAGEMENT_KEY,undefined,{revalidate:false});
      }
    });
    return ()=>listener.data.subscription.unsubscribe();
  },[mutate]);
  return account;
}
