// Independent LOC identity boundary. No Supabase, Neon or SQL imports.
// Verification is performed by a trusted LOC Authority endpoint, never by
// trusting a browser's user email, cached user object or a decoded JWT.
function exactOrigin(value,{allowLocalhost=false}={}){
  const url=new URL(String(value||''));
  const localhost=allowLocalhost&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(!(url.protocol==='https:'||(localhost&&url.protocol==='http:'))||
    url.username||url.password||url.search||url.hash||
    !['','/'].includes(url.pathname))throw new Error('Invalid LOC HTTPS origin');
  return url.origin;
}
export function clerkReturnPath(value,origin){
  const site=new URL(origin);
  const candidate=String(value||'/local/settings/');
  if(candidate.includes('\\')||candidate.startsWith('//'))return '/local/settings/';
  const relative=candidate.startsWith('/');
  const absolute=candidate.startsWith('https://');
  if(!relative&&!absolute)return '/local/settings/';
  try{
    const parsed=new URL(candidate,site);
    return parsed.origin===site.origin?parsed.pathname+parsed.search+parsed.hash:'/local/settings/';
  }catch{return '/local/settings/';}
}
export function createIndependentClerkIdentity({loadClerk,authorityOrigin,
  fetchImpl=globalThis.fetch,navigate=path=>globalThis.location.assign(path),
  siteOrigin=globalThis.location?.origin}={}){
  if(typeof loadClerk!=='function')throw new Error('Clerk loader is required');
  if(typeof fetchImpl!=='function')throw new Error('HTTPS fetch is required');
  const authority=exactOrigin(authorityOrigin);
  // Static export may instantiate clients during SSR, without location.
  // Resolve the browser origin only for an actual interactive login.
  const origin=siteOrigin?exactOrigin(siteOrigin,{allowLocalhost:true}):null;
  let currentPromise=null;
  const client=()=>currentPromise??=Promise.resolve().then(loadClerk).catch(error=>{
    currentPromise=null;
    throw error;
  });
  async function token(){
    const clerk=await client();
    if(!clerk?.session||!clerk.user?.id)return null;
    const jwt=await clerk.session.getToken();
    if(!jwt||typeof jwt!=='string')throw new Error('Clerk did not provide a session token');
    return jwt;
  }
  // Multiple listeners and the protected editor can request the same
  // signed identity simultaneously. One in-flight Authority verification per
  // exact Clerk JWT avoids redundant remote calls without caching any grant.
  let pendingIdentity=null,pendingIdentityToken='';
  // UX-only identity reuse; no management grants are cached. SQL RLS checks
  // every protected operation. Never persist the JWT or verified identity.
  const IDENTITY_REUSE_MS=2*60*60*1000;
  let recentIdentity=null;
  async function verifiedIdentity(){
    const clerk=await client();
    const jwt=await token();
    if(!jwt){recentIdentity=null;return null;}
    // Session ID, not a short-lived JWT string, identifies a continuing login.
    // If a mocked/older SDK exposes no Session ID, fail closed to exact-token reuse.
    const sessionId=String(clerk.session?.id||'');
    const sameSession=Boolean(recentIdentity&&recentIdentity.subject===clerk.user?.id&&
      (sessionId?sessionId===recentIdentity.identity.session:jwt===recentIdentity.token));
    if(sameSession&&Date.now()<recentIdentity.expires)return recentIdentity.identity;
    if(recentIdentity&&!sameSession)recentIdentity=null;
    if(pendingIdentity&&pendingIdentityToken===jwt)return pendingIdentity;
    const pending=(async()=>{
      // Retry a dropped network request once; HTTP 401/403 is never retried.
      const request=()=>fetchImpl(authority+'/v1/identity',{
        method:'GET',cache:'no-store',credentials:'omit',
        headers:{authorization:'Bearer '+jwt,accept:'application/json'}
      });
      let response;
      try{response=await request();}
      catch(error){
        if(!(error instanceof TypeError))throw error;
        try{response=await request();}
        catch(secondError){
          throw new Error('LOC 身分核驗連線失敗，請重新確認登入狀態。',{cause:secondError});
        }
      }
      if(!response.ok){
        let reason='';
        try{
          const data=await response.json();
          if(typeof data?.error==='string')reason=data.error.slice(0,160);
        }catch{}
        throw new Error('LOC Authority rejected Clerk identity (HTTP '+response.status+
          (reason?'：'+reason:'')+')');
      }
      const identity=await response.json();
      if(identity?.provider!=='clerk'||identity.subject!==clerk.user?.id||
        typeof identity.session!=='string'||!identity.session.startsWith('sess_'))
        throw new Error('Clerk identity mismatch');
      const email=String(identity.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error('Clerk token requires a verified signed email claim for LOC management');
      return Object.freeze({
        provider:'clerk',subject:identity.subject,session:identity.session,email
      });
    })();
    pendingIdentityToken=jwt;
    pendingIdentity=pending;
    try{
      const identity=await pending;
      recentIdentity={token:jwt,subject:identity.subject,identity,
        expires:Date.now()+IDENTITY_REUSE_MS};
      return identity;
    }catch(error){
      recentIdentity=null;
      throw error;
    }finally{
      if(pendingIdentity===pending){
        pendingIdentity=null;
        pendingIdentityToken='';
      }
    }
  }
  async function getAccessToken(){
    const jwt=await token();
    if(!jwt)throw new Error('Clerk login required');
    return jwt;
  }
  async function signIn(returnTo='/local/settings/'){
    if(!origin)throw new Error('Clerk sign-in requires a browser origin');
    const destination='/login/index.html?return_to='+
      encodeURIComponent(clerkReturnPath(returnTo,origin));
    navigate(destination);
  }
  async function signOut(){
    recentIdentity=null;
    const clerk=await client();
    await clerk.signOut();
  }
  async function onChange(callback){
    if(typeof callback!=='function')throw new Error('Auth listener must be a function');
    const clerk=await client();
    return clerk.addListener(()=>{
      const signedIn=Boolean(clerk.session&&clerk.user);
      if(!signedIn||recentIdentity&&(
        recentIdentity.subject!==clerk.user?.id||
        clerk.session?.id&&recentIdentity.identity.session!==clerk.session.id))recentIdentity=null;
      callback(signedIn);
    });
  }
  return Object.freeze({verifiedIdentity,getAccessToken,signIn,signOut,onChange});
}
