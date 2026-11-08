// LOC-owned browser identity adapter. Only LOC Authority signs identity tokens.
// A verified OAuth session is not itself permission to write to the database.
const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const LOC_SUBJECT=/^loc_[A-Za-z0-9_-]{32,80}$/;
function origin(value){
 const u=new URL(String(value||''));
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
  !['','/'].includes(u.pathname))throw new Error('Invalid LOC Auth origin');
 return u.origin;
}
function returnPath(value){
 const path=String(value||'/local/settings/');
 if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))
   return '/local/settings/';
 return path;
}
export function createLocAccountAdapter({authorityOrigin=DEFAULT_AUTHORITY,
 fetchImpl=globalThis.fetch,navigate=value=>globalThis.location.assign(value)}={}){
 const authority=origin(authorityOrigin);
 let cached=null,pending=null;
 const listeners=new Set();
 async function verified(force=false){
  if(!force&&cached&&cached.until>Date.now())return cached.value;
  if(pending)return pending;
  pending=(async()=>{
   const res=await fetchImpl(authority+'/v1/auth/session',{
    method:'GET',credentials:'include',cache:'no-store',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
   });
   if(!res.ok)throw new Error('LOC Auth session unavailable (HTTP '+res.status+')');
   const payload=await res.json();
   if(!payload?.session)return null;
   const user=payload.user,session=payload.session;
   if(!LOC_SUBJECT.test(String(user?.id||''))||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email||''))||
    user.id!==session.user?.id||
    typeof session.access_token!=='string'||session.access_token.split('.').length!==3||
    !Number.isSafeInteger(session.expires_at)||
    session.expires_at*1000<Date.now()+30000)
    throw new Error('LOC Auth returned invalid signed session metadata');
   return {user,session,oauth:{provider:'loc',providerId:user.id,
    userId:user.id,email:user.email}};
  })();
  try{const data=await pending;cached={value:data,
    until:Date.now()+Math.min(60000,data?Math.max(0,data.session.expires_at*1000-Date.now()-60000):20000)};
   return data;
  }finally{pending=null;}
 }
 async function getAccessToken(){
  const state=await verified();if(!state)throw new Error('LOC login required');
  return state.session.access_token;
 }
 async function session(){return verified();}
 const auth={
  getVerifiedSession:session,
  getAccessToken,
  async getSession(){
   try{return {data:{session:(await verified())?.session||null},error:null};}
   catch(error){return {data:{session:null},error};}
  },
  async getUser(token){
   try{
    const identity=await verified();
    if(!identity||identity.session.access_token!==token)
      throw new Error('LOC OAuth token is not the current verified session');
    return {data:{user:identity.user},error:null};
   }catch(error){return {data:{user:null},error};}
  },
  async signInWithOAuth({provider,options={}}={}){
   // The Google identity is already verified by the configured Supabase Auth
   // provider. Never redirect it to an unrelated, unconfigured OIDC issuer.
   const selected=['google','github','oidc'].includes(provider)?provider:'';
   if(!selected)return {data:null,error:new Error('Unsupported OAuth provider')};
   // A valid LOC-owned session is authoritative for all its applications.
   // A fresh provider round-trip is not needed just to reopen settings/MCP.
   const existing=await verified();
   if(existing)return {data:{session:existing.session},error:null};
   const link=new URL('/oauth/login',authority);
   link.searchParams.set('provider',selected);
   link.searchParams.set('return_to',returnPath(options.redirectTo));
   navigate(link.href);
   return {data:{},error:null};
  },
  async signOut(){
   try{
    const res=await fetchImpl(authority+'/oauth/logout',{
     method:'POST',credentials:'include',cache:'no-store',
     headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
    });
    if(!res.ok)throw new Error('LOC Auth sign-out failed');
    cached=null;
    for(const listener of [...listeners])listener('SIGNED_OUT',null);
    return {error:null};
   }catch(error){return {error};}
  },
  onAuthStateChange(callback){
   if(typeof callback!=='function')throw new Error('Auth callback required');
   let disposed=false,lastSubject=undefined;
   listeners.add(callback);
   const emit=async(initial=false)=>{
    let identity;
    try{identity=await verified(!initial);}catch{identity=null;}
    if(disposed)return;
    const subject=identity?.user?.id||null;
    if(initial||subject!==lastSubject){
     lastSubject=subject;
     callback(initial?'INITIAL_SESSION':subject?'SIGNED_IN':'SIGNED_OUT',
       identity?.session||null);
    }
   };
   const focus=()=>void emit().catch(()=>{});
   if(typeof window!=='undefined'){
    window.addEventListener('focus',focus);
    window.addEventListener('pageshow',focus);
   }
   void emit(true);
   return {data:{subscription:{unsubscribe(){
    disposed=true;listeners.delete(callback);
    if(typeof window!=='undefined'){
     window.removeEventListener('focus',focus);
     window.removeEventListener('pageshow',focus);
    }
   }}}};
  }
 };
 return Object.freeze({auth,getAccessToken});
}
