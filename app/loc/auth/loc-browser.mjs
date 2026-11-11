// This is a Better Auth browser SDK adapter, not an Auth implementation.
// LOC public pages never contact Auth. Only explicit sign-in, edit and
// personal-profile actions ask the Better Auth SDK for a verified session.
const ISSUER='https://auth.lo3rwang.cc';
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
  authorityOrigin=ISSUER,
  navigate=url=>globalThis.location.assign(url)
}={}){
  if(new URL(authorityOrigin).origin!==ISSUER)
    throw Error('Untrusted LOC Auth issuer');
  let lazyClient=null;
  async function client(){
    if(!lazyClient)lazyClient=import('better-auth/client').then(({createAuthClient})=>
      createAuthClient({baseURL:ISSUER,basePath:'/api/auth',
        fetchOptions:{credentials:'include'}}));
    return lazyClient;
  }
  const listeners=new Set();

  // In-memory session cache: one network round-trip per 60 seconds max.
  // Data updates at most monthly; auth re-verification on every action is wasteful.
  // signOut / signIn always clear the cache so the next call gets a fresh result.
  const SESSION_CACHE_TTL_MS=60*1000;
  let sessionCache=null; // {value, expiresAt}
  let pendingSession=null; // in-flight promise dedup

  function clearSessionCache(){
    sessionCache=null;
    pendingSession=null;
  }

  async function fetchSession(){
    const {data,error}=await (await client()).getSession();
    if(error)throw Error(error.message||'LOC Auth session unavailable');
    if(!data?.session||!data?.user||data.user.emailVerified!==true)
      return null;
    const user=data.user;
    return {user,session:{...data.session,user},oauth:{
      provider:'loc',providerId:user.id,userId:user.id,
      email:user.email
    }};
  }

  async function session({bypass=false}={}){
    if(!bypass){
      if(sessionCache&&Date.now()<sessionCache.expiresAt)
        return sessionCache.value;
      if(pendingSession)return pendingSession;
    }
    const p=fetchSession().then(value=>{
      if(!bypass){
        sessionCache={value,expiresAt:Date.now()+SESSION_CACHE_TTL_MS};
        pendingSession=null;
      }
      return value;
    },error=>{
      if(!bypass)pendingSession=null;
      throw error;
    });
    if(!bypass)pendingSession=p;
    return p;
  }

  async function emit(){
    const value=await session({bypass:true}).catch(()=>null);
    clearSessionCache();
    sessionCache={value,expiresAt:Date.now()+SESSION_CACHE_TTL_MS};
    for(const listener of [...listeners]){
      listener(value?'SIGNED_IN':'SIGNED_OUT',value?.session||null);
    }
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
        return {data:null,error:new Error('LOC Google OAuth is the configured sign-in provider')};
      try{
        clearSessionCache();
        const returnTo=safeReturn(options.redirectTo);
        const response=await (await client()).signIn.social({
          provider:'google',
          callbackURL:new URL(returnTo,'https://loc.lo3rwang.cc').href
        });
        return response;
      }catch(error){clearSessionCache();return {data:null,error};}
    },
    async signOut(){
      try{
        clearSessionCache();
        const result=await (await client()).signOut();
        await emit();
        return result;
      }catch(error){clearSessionCache();return {error};}
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
