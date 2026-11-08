import {betterAuth} from 'better-auth';
import {createAdapterFactory} from 'better-auth/adapters';
import {checkExternalAuthQos} from './auth-qos.mjs';

// LOC remains the issuer. Better Auth owns first-party email/password accounts.
// Its storage adapter uses the existing Authority Durable Object, not SQL DDL.
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
  return {
   create:({model,data})=>call('create',{model,data}),
   findOne:({model,where})=>call('findOne',{model,where}),
   findMany:({model,where,limit,offset,sortBy})=>
    call('findMany',{model,where,limit,offset,sortBy}),
   count:({model,where})=>call('count',{model,where}),
   update:({model,where,update})=>call('update',{model,where,update}),
   updateMany:({model,where,update})=>call('updateMany',{model,where,update}),
   delete:({model,where})=>call('delete',{model,where}),
   deleteMany:({model,where})=>call('deleteMany',{model,where})
  };
 }
});
function state(env){
 if(!env.LOC_AUTHORITY_STATE)throw new Error('LOC Authority state unavailable');
 return env.LOC_AUTHORITY_STATE.get(env.LOC_AUTHORITY_STATE.idFromName('loc-authority-control-v1'));
}
async function sendLocVerification(env,{user,url}){
 const endpoint=String(env.LOC_AUTH_EMAIL_ENDPOINT||'');
 const token=String(env.LOC_AUTH_EMAIL_TOKEN||'');
 let address;
 try{address=new URL(endpoint)}catch{throw new Error('LOC email sender not configured')}
 if(address.protocol!=='https:'||!address.hostname||address.username||
   address.password||address.hash||address.search||
   address.hostname==='localhost'||address.hostname.endsWith('.local')||
   !/^[A-Za-z0-9_-]{32,256}$/.test(token))
   throw new Error('LOC email sender configuration invalid');
 const verifyUrl=new URL(url);
 if(verifyUrl.origin!==ISSUER||!verifyUrl.pathname.startsWith('/api/auth/verify-email'))
   throw new Error('LOC email verification origin invalid');
 const sent=await fetch(address.href,{method:'POST',redirect:'error',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({to:String(user.email||''),subject:'驗證你的 LOC 帳號',
    verify_url:verifyUrl.href}),
  signal:AbortSignal.timeout(8000)});
 if(!sent.ok)throw new Error('LOC email verification delivery unavailable');
}

export function locBetterAuth(env){
 if(!env.LOC_CONTROL_ENCRYPTION_KEY)
  throw new Error('LOC Auth encryption key unavailable');
 const stub=state(env);
 return betterAuth({
  appName:'LOC Auth',
  baseURL:ISSUER,basePath:'/api/auth',
  secret:env.LOC_CONTROL_ENCRYPTION_KEY,
  trustedOrigins:[ISSUER,WEB],
  database:(options)=>ADAPTER({...options,__locState:stub}),
  emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128},
  emailVerification:{
   sendOnSignUp:Boolean(env.LOC_AUTH_EMAIL_ENDPOINT),
   sendOnSignIn:Boolean(env.LOC_AUTH_EMAIL_ENDPOINT),
   expiresIn:3600,
   sendVerificationEmail:data=>sendLocVerification(env,data)
  },
  // A native account must not inherit another issuer's identity or grants.
  account:{accountLinking:{enabled:false}},
  session:{expiresIn:7200,updateAge:1800},
  rateLimit:{enabled:true,window:60,max:30},
  advanced:{useSecureCookies:true,ipAddress:{ipAddressHeaders:['cf-connecting-ip']}}
 });
}
export function hasFirstPartyCookie(request){
 return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(
  request.headers.get('cookie')||'');
}
export async function firstPartySignOut(request,env){
 return locBetterAuth(env).api.signOut({headers:request.headers,asResponse:true});
}
export async function firstPartySession(request,env){
 const existing=await locBetterAuth(env).api.getSession({headers:request.headers});
 if(!existing?.session||!existing?.user)return null;
 const expires=new Date(existing.session.expiresAt).getTime();
 if(!Number.isFinite(expires)||expires<=Date.now())return null;
 return {userId:String(existing.user.id),email:String(existing.user.email||'').toLowerCase(),
  emailVerified:existing.user.emailVerified===true,expires};
}
function cors(request){
 const origin=request.headers.get('origin')||'';
 return origin===WEB||origin===ISSUER?origin:'';
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
 const limited=await checkExternalAuthQos(request,env);
 if(limited)return limited;
 const result=await locBetterAuth(env).handler(request);
 const headers=new Headers(result.headers);
 headers.set('cache-control','no-store');
 if(origin){
  headers.set('access-control-allow-origin',origin);
  headers.set('access-control-allow-credentials','true');
  headers.set('vary','Origin');
 }
 return new Response(result.body,{status:result.status,headers});
}
