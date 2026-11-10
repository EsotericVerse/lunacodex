import {betterAuth} from 'better-auth';
import {createAdapterFactory} from 'better-auth/adapters';
import {checkExternalAuthQos} from './auth-qos.mjs';

// Better Auth supplies the Google OAuth protocol, not LOC Scope privileges.
// LOC owns its Session/PKCE/Scope/DB authorization in the existing Authority.
const ISSUER='https://auth.lo3rwang.cc';
const WEB='https://loc.lo3rwang.cc';
const ADAPTER=createAdapterFactory({
 config:{adapterId:'loc-authority',adapterName:'LOC Authority Durable Storage',
  supportsJSON:true,supportsDates:true,supportsBooleans:true,
  supportsNumericIds:false,transaction:false},
 adapter:({options})=>{
  const stub=options.__locState;
  if(!stub)throw new Error('LOC Better Auth state unavailable');
  const call=(operation,params)=>stub.betterAuthStorage({operation,...params});
  // A Google identity is enough for LOC; OAuth access/refresh/ID tokens do
  // not need to persist in our durable identity index after the callback.
  const redacted=(model,data)=>{
   if(model!=='account'||!data)return data;
   const out={...data};
   for(const key of ['accessToken','refreshToken','idToken'])delete out[key];
   return out;
  };
  return {
   create:({model,data})=>call('create',{model,data:redacted(model,data)}),
   findOne:({model,where})=>call('findOne',{model,where}),
   findMany:({model,where,limit,offset,sortBy})=>
    call('findMany',{model,where,limit,offset,sortBy}),
   count:({model,where})=>call('count',{model,where}),
   update:({model,where,update})=>
    call('update',{model,where,update:redacted(model,update)}),
   updateMany:({model,where,update})=>
    call('updateMany',{model,where,update:redacted(model,update)}),
   delete:({model,where})=>call('delete',{model,where}),
   deleteMany:({model,where})=>call('deleteMany',{model,where})
  };
 }
});
function state(env){
 if(!env.LOC_AUTHORITY_STATE)throw new Error('LOC Authority state unavailable');
 return env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
}
export function googleSettings(env){
 const clientId=String(env.LOC_GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_ID||'').trim();
 const clientSecret=String(env.LOC_GOOGLE_CLIENT_SECRET||env.GOOGLE_CLIENT_SECRET||'').trim();
 if(!clientId||!clientSecret)
  throw Object.assign(new Error('LOC Google OAuth Client ID/Secret not bound to existing Worker'),{status:503});
 return {clientId,clientSecret};
}
export function locBetterAuth(env){
 const {clientId,clientSecret}=googleSettings(env);
 if(!env.LOC_CONTROL_ENCRYPTION_KEY)
  throw Object.assign(new Error('LOC Auth encryption key unavailable'),{status:503});
 const stub=state(env);
 return betterAuth({
  appName:'LOC Auth',baseURL:ISSUER,basePath:'/api/auth',
  secret:env.LOC_CONTROL_ENCRYPTION_KEY,
  trustedOrigins:[ISSUER,WEB],
  database:(options)=>ADAPTER({...options,__locState:stub}),
  // No LOC password signup or login. Better Auth may persist a Google identity,
  // while LOC assigns Subject and permits writes only for its anchored owner.
  emailAndPassword:{enabled:false},
  socialProviders:{google:{clientId,clientSecret,disableIdTokenSignIn:true}},
  account:{accountLinking:{enabled:false}},
  session:{expiresIn:30*86400,updateAge:86400},
  rateLimit:{enabled:true,window:60,max:30},
  advanced:{useSecureCookies:true,ipAddress:{ipAddressHeaders:['cf-connecting-ip']}}
 });
}
export function hasFirstPartyCookie(request){
 return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(
  request.headers.get('cookie')||'');
}
export async function firstPartySession(request,env){
 const auth=locBetterAuth(env);
 const existing=await auth.api.getSession({headers:request.headers});
 if(!existing?.session||!existing?.user||existing.user.emailVerified!==true)return null;
 const expires=new Date(existing.session.expiresAt).getTime();
 if(!Number.isFinite(expires)||expires<=Date.now())return null;
 const accounts=await auth.api.listUserAccounts({headers:request.headers});
 const google=Array.isArray(accounts)?accounts.find(a=>a.providerId==='google'):null;
 if(!google||typeof google.accountId!=='string'||!google.accountId)return null;
 return {googleAccountId:google.accountId,email:String(existing.user.email||'').trim().toLowerCase(),
  emailVerified:true,expires};
}
export async function firstPartySignOut(request,env){
 return locBetterAuth(env).api.signOut({headers:request.headers,asResponse:true});
}
function cors(request){
 const origin=request.headers.get('origin')||'';
 return origin===WEB||origin===ISSUER?origin:'';
}
// Direct navigation to Google's callback is not an OAuth response. Render
// LOC's regular login experience instead of Better Auth's state_not_found page.
// Real provider redirects (state, code, or error) must reach Better Auth intact.
export function directGoogleCallbackRedirect(request){
 const url=new URL(request.url);
 if(request.method!=='GET'||url.pathname!=='/api/auth/callback/google'||url.search)
  return null;
 return new Response(null,{status:302,headers:{
  location:WEB+'/login/index.html?return_to=%2Flocal%2Fsettings%2F',
  'cache-control':'no-store'
 }});
}
export async function handleFirstPartyAuth(request,env){
 const origin=cors(request);
 if(request.method==='OPTIONS'){
  if(!origin)return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{
   'access-control-allow-origin':origin,
   'access-control-allow-credentials':'true',
   'access-control-allow-headers':'content-type',
   'access-control-allow-methods':'GET,POST,OPTIONS',
   'access-control-max-age':'600','vary':'Origin'}});
 }
 if(request.headers.get('origin')&&!origin)return new Response('Origin denied',{status:403});
 const directCallback=directGoogleCallbackRedirect(request);
 if(directCallback)return directCallback;
 // Reject legacy registration/password endpoints even if the library exposes
 // an internal handler for them. Google callback stays available.
 if(/^\/api\/auth\/(?:sign-up\/|sign-in\/email|sign-in\/username|reset-password|request-password-reset|change-password|set-password)/.test(new URL(request.url).pathname))
  return new Response(JSON.stringify({error:'LOC password login and registration disabled'}),{
   status:410,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const limited=await checkExternalAuthQos(request,env);
 if(limited)return limited;
 try{
  const result=await locBetterAuth(env).handler(request);
  const headers=new Headers(result.headers);
  headers.set('cache-control','no-store');
  if(origin){
   headers.set('access-control-allow-origin',origin);
   headers.set('access-control-allow-credentials','true');
   headers.set('vary','Origin');
  }
  return new Response(result.body,{status:result.status,headers});
 }catch(error){
  return new Response(JSON.stringify({error:'LOC Google OAuth unavailable'}),{
   status:Number(error?.status)||503,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }
}
