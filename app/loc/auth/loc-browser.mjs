// This is a Better Auth browser SDK adapter, not an Auth implementation.
// LOC public pages never contact Auth. Only explicit sign-in, edit and
// personal-profile actions ask the Better Auth SDK for a verified session.
import {LOC_SERVICE_ORIGINS} from '../../modular/routing/service-route-index.mjs';
const ISSUER=LOC_SERVICE_ORIGINS.auth;
const DEFAULT_RETURN='/local/settings/';
function safeReturn(path){
  let parsed;
  try{parsed=new URL(String(path||DEFAULT_RETURN),'https://loc.lo3rwang.cc');}
  catch{return DEFAULT_RETURN;}
  if(parsed.origin!=='https://loc.lo3rwang.cc'||!parsed.pathname.startsWith('/'))
    return DEFAULT_RETURN;
  return parsed.pathname+parsed.search;
}
export function createLocAccountAdapter({
  authorityOrigin=ISSUER
}={}){
  if(new URL(authorityOrigin).origin!==ISSUER)
    throw Error('Untrusted LOC Auth issuer');
  let lazyClient=null;
  async function client(){
    if(!lazyClient)lazyClient=import('better-auth/client')
      .then(({createAuthClient})=>createAuthClient({
      baseURL:ISSUER,basePath:'/api/auth',
      // Better Auth owns Session state. Protected pages request a Session
      // explicitly; there are no automatic polls or focus-driven rechecks.
      sessionOptions:{refetchInterval:0,refetchOnWindowFocus:false,
        refetchWhenOffline:false},
      fetchOptions:{credentials:'include'}
    }));

    return lazyClient;
  }
  const listeners=new Set();

  // One in-flight Better Auth getSession() per explicit protected action.
  // Better Auth owns signed cookie cache, Session expiry and revocation.
  // No second browser Session TTL or long-lived signed-out cache.
  let pendingSession=null;
  async function session(){
    if(pendingSession)return pendingSession;
    const task=(async()=>{
      const {data,error}=await (await client()).getSession();
      if(error)throw Error(error.message||'LOC Auth session unavailable');
      if(!data?.session||!data?.user||data.user.emailVerified!==true)
        return null;
      const user=data.user;
      return {user,session:{...data.session,user},oauth:{
        provider:'loc',providerId:user.id,userId:user.id,email:user.email
      }};
    })();
    pendingSession=task;
    try{return await task}
    finally{if(pendingSession===task)pendingSession=null;}
  }

  const auth={
    getVerifiedSession:()=>session(),
    async getSession(){
      try{return {data:{session:(await session())?.session||null},error:null};}
      catch(error){return {data:{session:null},error};}
    },
    async getUser(){
      try{return {data:{user:(await session())?.user||null},error:null};}
      catch(error){return {data:{user:null},error};}
    },
    async signInWithOAuth({provider,options={}}={}){
      if(provider!=='google')
        return {data:null,error:new Error('Google OAuth is the configured LOC Auth provider')};
      try{
        // LAS owns OAuth initiation, callback and Session; LOC keeps the return path.
        const returnTo=safeReturn(options.redirectTo);
        const loginURL=new URL('/login',ISSUER);
        loginURL.searchParams.set('return_to',returnTo);
        if(typeof window==='undefined'||typeof window.location?.assign!=='function')
          throw Error('LOC Auth login requires browser navigation');
        window.location.assign(loginURL.href);
        return {data:{url:loginURL.href},error:null};
      }catch(error){return {data:null,error};}
    },
    async signOut(){
      try{
        const result=await (await client()).signOut();
        if(result?.error)return result;
        // Only successful Better Auth sign-out invalidates the Web's
        // in-memory UI grants. Failed network sign-out is not a logout.
        for(const listener of [...listeners])listener('SIGNED_OUT',null);
        return result;
      }catch(error){return {error};}
    },
    onAuthStateChange(callback){
      if(typeof callback!=='function')throw Error('LOC Auth callback required');
      listeners.add(callback);
      // Passive website rendering never triggers a session request.
      callback('INITIAL_SESSION',null);
      return {data:{subscription:{unsubscribe(){
        listeners.delete(callback);
      }}}};
    }
  };
  return Object.freeze({auth,
    // Resource tokens belong to Better Auth OAuth Provider /oauth2/token.
    // An opaque browser session must never be repackaged as a signed token.
    async getAccessToken(){
      throw Error('LOC Auth OAuth resource client authorization required');
    }});
}
