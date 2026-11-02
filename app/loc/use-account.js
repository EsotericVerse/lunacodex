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
// Supabase RLS / RPC write authorization.
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
// How recently the SAME identity's management grants were confirmed against
// the server (Clerk session + silver.get_my_scope_management RPC). Entering a
// second management page for the same identity within this window reuses the
// just-confirmed grants instead of repeating both round trips; any real
// sign-out or identity change still clears this immediately (see
// clearAuthorization() call sites) and is caught instantly by the dedicated
// Auth-event listener in ManagementAccess, independent of this window.
let lastVerifiedAt=0;
const MANAGEMENT_REVERIFY_TTL_MS=20_000;

// Permission authority lives in ordinary JS memory, not in a React hook.
// No TTL, JSON parsing, file I/O or permission SQL on subsequent actions.
function cachedManagementAccount(){
  const saved=readAuthorization();
  if(!saved||!saved.userId||
    (authUserId&&saved.userId!==authUserId)||
    (authEmail&&saved.email!==authEmail))return null;
  const user={id:saved.userId,email:saved.email};
  const authorizer=createScopeAuthorizer(user);
  if(!authorizer)return null;
  return {...signedOutState,user,email:saved.email,
    role:authorizer.role,authorizer,scopes:scopeMetadata};
}

async function loadManagementAccount(mutate,{forceVerify=false}={}){
  // A forced verify still skips the network round trip when the exact same
  // identity was confirmed moments ago: this is an explicit, bounded window
  // (MANAGEMENT_REVERIFY_TTL_MS), not an unconditional skip of forceVerify.
  const withinReverifyWindow=lastVerifiedAt&&(Date.now()-lastVerifiedAt<MANAGEMENT_REVERIFY_TTL_MS);
  const cached=(forceVerify&&!withinReverifyWindow)?null:cachedManagementAccount();
  if(cached)return cached;
  const startedAt=authRevision;
  const obsolete=()=>startedAt!==authRevision;
  let verifiedIdentity=null;
  try{
    // Both endpoints independently verify the current signed Clerk JWT.
    // Start them together instead of spending an extra network round trip
    // between Authority identity and the protected Scope permissions RPC.
    const [sessionRead,permissionRead]=await Promise.allSettled([
      getAccountSession(),
      dbAuthClient.schema('silver').rpc('get_my_scope_management')
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
      lastVerifiedAt=0;
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
    lastVerifiedAt=Date.now();
    return cachedManagementAccount()||signedOutState;
  }catch(error){
    // An older request must not erase a newer account's verified grants.
    if(obsolete())return signedOutState;
    // A failed permission read (e.g. database blocked) must not erase verified
    // grants already cached for this user; keep the last known authorization.
    const cached=forceVerify?null:cachedManagementAccount();
    if(cached)return cached;
    // If a deliberate recheck fails, show the error rather than pretending
    // the visitor signed out or silently trusting an old management snapshot.
    clearAuthorization();
    scopeMetadata=[];
    authUserId='';
    authEmail='';
    lastVerifiedAt=0;
    return verifiedIdentity
      ?{...signedOutState,...verifiedIdentity,error:String(error?.message||error)}
      :failedState(error);
  }
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

  // An explicit action checks current JS variables on every click. Only a
  // missing/invalidated snapshot loads one server-verified permission set.
  const refresh=useCallback(async({forceVerify=false}={})=>{
    if(!sessionOnly&&!forceVerify){
      const cached=cachedManagementAccount();
      if(cached)return {user:cached.user,authorizer:cached.authorizer};
    }
    const fetcher=forceVerify&&!sessionOnly
      ?()=>loadManagementAccount(mutate,{forceVerify:true}):queryFn;
    const result=await mutate(queryKey,fetcher,{revalidate:false});
    // A permission RPC failure is not proof that the user logged out.
    if(result?.error)throw new Error(result.error);
    if(sessionOnly)return result?.user||null;
    return result?.user&&result.authorizer?{user:result.user,authorizer:result.authorizer}:null;
  },[mutate,queryKey,queryFn,sessionOnly]);

  const signIn=useCallback(callbackURL=>signInWithGoogle(String(callbackURL||'').trim()),[]);
  const signOut=useCallback(async()=>{
    await signOutAccount();
    authRevision+=1;
    authUserId='';
    authEmail='';
    clearAuthorization();
    scopeMetadata=[];
    lastVerifiedAt=0;
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
      // On a fresh static management page the verified Clerk session can
      // arrive while the management RPC is still in flight. Hydration is
      // NOT a sign-out or replacement of an existing authorized identity.
      const invalidate=shouldInvalidateManagementForAuthEvent({
        event,previousUserId:authUserId,previousEmail:authEmail,
        nextUserId,nextEmail,hasAuthorization:Boolean(readAuthorization())
      });
      if(invalidate){
        authRevision+=1;
        clearAuthorization();
        scopeMetadata=[];
        lastVerifiedAt=0;
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
