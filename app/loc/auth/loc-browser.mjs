// This is a Better Auth browser SDK adapter, not an Auth implementation.
// LOC public pages never contact Auth. Only explicit sign-in, edit and
// personal-profile actions ask the Better Auth SDK for a verified session.
const ISSUER='https://auth.lo3rwang.cc';
const DEFAULT_RETURN='/local/settings/';
function safeReturn(path){
  const text=String(path||DEFAULT_RETURN);
  if(!text.startsWith('/')||text.startsWith('//')||text.includes('\\'))
    return DEFAULT_RETURN;
  return text;
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
  async function session(){
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
  async function emit(){
    const value=await session().catch(()=>null);
    for(const listener of [...listeners]){
      listener(value?'SIGNED_IN':'SIGNED_OUT',value?.session||null);
    }
  }
  const auth={
    getVerifiedSession:session,
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
        const returnTo=safeReturn(options.redirectTo);
        const response=await (await client()).signIn.social({
          provider:'google',
          callbackURL:new URL(returnTo,'https://loc.lo3rwang.cc').href
        });
        return response;
      }catch(error){return {data:null,error};}
    },
    async signOut(){
      try{
        const result=await (await client()).signOut();
        await emit();
        return result;
      }catch(error){return {error};}
    },
    onAuthStateChange(callback){
      if(typeof callback!=='function')throw Error('LOC Auth callback required');
      listeners.add(callback);
      // Passive website rendering never triggers a session request.
      callback('INITIAL_SESSION',null);
      const focus=()=>void emit();
      if(typeof window!=='undefined')window.addEventListener('focus',focus);
      return {data:{subscription:{unsubscribe(){
        listeners.delete(callback);
        if(typeof window!=='undefined')window.removeEventListener('focus',focus);
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
