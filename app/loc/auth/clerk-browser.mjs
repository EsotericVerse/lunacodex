// The only browser Clerk SDK loader. Do not import a DB Auth SDK here.
import {createIndependentClerkIdentity} from './clerk-identity.mjs';

let clerkPromise=null;
function secureOrigin(value){
  const url=new URL(String(value||''));
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !['','/'].includes(url.pathname))throw new Error('Invalid Clerk Frontend API URL');
  return url.origin;
}
async function loadScript(url,attributes={}){
  await new Promise((resolve,reject)=>{
    const node=document.createElement('script');
    node.src=url;node.async=true;node.crossOrigin='anonymous';
    for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
    node.onload=resolve;
    node.onerror=()=>reject(new Error('Cannot load Clerk browser SDK'));
    document.head.appendChild(node);
  });
}
export async function loadLocClerk(){
  if(typeof window==='undefined')throw new Error('Clerk needs a browser');
  if(clerkPromise)return clerkPromise;
  clerkPromise=(async()=>{
    const r=await fetch('/recovery/config.json',{cache:'no-store'});
    if(!r.ok)throw new Error('LOC Clerk configuration unavailable');
    const cfg=await r.json();
    if(!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(String(cfg.publishableKey||'')))
      throw new Error('Invalid LOC Clerk publishable key');
    const origin=secureOrigin(cfg.frontendApiUrl);
    if(!window.Clerk){
      // Two independent static bundles; clerk.load() below is the only step
      // that needs both finished, so fetch them concurrently instead of
      // serially to cut first-load latency.
      await Promise.all([
        loadScript(origin+'/npm/@clerk/ui@1/dist/ui.browser.js'),
        loadScript(origin+'/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
          {'data-clerk-publishable-key':cfg.publishableKey})
      ]);
    }
    const clerk=window.Clerk;
    if(!clerk)throw new Error('Clerk SDK did not initialize');
    await clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});
    return clerk;
  })().catch(error=>{clerkPromise=null;throw error});
  return clerkPromise;
}
// Produces an Auth event interface for existing LOC useAccount consumers.
// Session verification and rights are separated: a verified identity never
// gains management rights until LOC Authority/SQL policies allow it.
export function createClerkAccountAdapter({authorityOrigin,
  loadClerk=loadLocClerk,fetchImpl=globalThis.fetch,
  navigate=path=>globalThis.location.assign(path),
  siteOrigin=globalThis.location?.origin}={}){
  const identity=createIndependentClerkIdentity({
    authorityOrigin,loadClerk,fetchImpl,navigate,siteOrigin
  });
  async function session(){
    const verified=await identity.verifiedIdentity();
    if(!verified)return null;
    const email=verified.email;
    const user={id:verified.subject,email};
    return {session:{user,access_token:await identity.getAccessToken()},
      user,oauth:{provider:'clerk',providerId:verified.subject,
        userId:verified.subject,email}};
  }
  const auth={
    getVerifiedSession:session,
    getAccessToken:identity.getAccessToken,
    async getSession(){
      try{
        const verified=await session();
        return {data:{session:verified?.session||null},error:null};
      }catch(error){return {data:{session:null},error};}
    },
    async getUser(token){
      try{
        const verified=await session();
        if(!verified||verified.session.access_token!==token)
          throw new Error('Clerk verified session token mismatch');
        return {data:{user:verified.user},error:null};
      }catch(error){return {data:{user:null},error};}
    },
    async signInWithOAuth({provider,options={}}={}){
      if(provider!=='google')return {data:null,error:new Error('Unsupported OAuth provider')};
      try{await identity.signIn(options.redirectTo||'/local/settings/');return {data:{},error:null};}
      catch(error){return {data:null,error};}
    },
    async signOut(){
      try{await identity.signOut();return {error:null};}
      catch(error){return {error};}
    },
    onAuthStateChange(callback){
      let disposed=false;let off=()=>{};
      const emit=async event=>{
        // An SDK listener can briefly report signedOut while the verified
        // session is still present (or while Clerk is initializing). Never
        // revoke editing on a stale event that contradicts the identity
        // returned by the signed Authority verification.
        const verified=await session();
        if(disposed)return;
        if(event==='SIGNED_OUT'&&verified?.session)return;
        if(event==='SIGNED_IN'&&!verified?.session)return;
        callback(event,verified?.session||null);
      };
      void identity.onChange(signedIn=>{
        if(!disposed)void emit(signedIn?'SIGNED_IN':'SIGNED_OUT').catch(()=>{});
      }).then(unsubscribe=>{
        off=typeof unsubscribe==='function'?unsubscribe:()=>{};
        if(disposed)off();
        else void emit('INITIAL_SESSION').catch(()=>{});
      }).catch(()=>{});
      return {data:{subscription:{unsubscribe(){disposed=true;off();}}}};
    }
  };
  return Object.freeze({auth,getAccessToken:identity.getAccessToken});
}
