import {createLocAuth,LOC_ISSUER,LOC_WEB} from './auth.mjs';
import {oauthProviderAuthServerMetadata,oauthProviderOpenIdConfigMetadata}
  from '@better-auth/oauth-provider';

// Only transport and OAuth login/consent UI remain here. No custom auth protocol.
let service;
function authFor(env){
  if(!service)service=createLocAuth(env).auth;
  return service;
}
const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const allowed=new Set([LOC_ISSUER,LOC_WEB,EXTENSION]);

function cors(request,response,publicMetadata=false){
  const origin=request.headers.get('origin');
  const headers=new Headers(response.headers);
  headers.set('cache-control','no-store');
  headers.set('x-content-type-options','nosniff');
  if(publicMetadata)headers.set('access-control-allow-origin','*');
  else if(origin&&allowed.has(origin)){
    headers.set('access-control-allow-origin',origin);
    headers.set('vary','Origin');
    if(origin!==EXTENSION)headers.set('access-control-allow-credentials','true');
  }
  return new Response(response.body,{status:response.status,headers});
}
function page(title,content,script){
  const html='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+title+' · LOC Auth</title><style>'+
    'body{font:16px system-ui;background:#12151e;color:#f0f2f6;max-width:480px;margin:10vh auto;padding:24px}'+
    'button{background:#e6e8ed;color:#151922;border:0;border-radius:8px;padding:12px 18px;cursor:pointer;margin-right:8px}'+
    'button:disabled{opacity:.5}small,p{color:#b9c0cc}a{color:#c8deff}'+
    '</style></head><body><main><h1>LOC Auth</h1>'+content+
    '<p id="status" role="status"></p></main><script>'+script+'</script></body></html>';
  return new Response(html,{headers:{
    'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'referrer-policy':'no-referrer'
  }});
}
const LOGIN_JS="const status=document.getElementById('status');\nconst q=location.search.slice(1);\nconst next=q?location.origin+'/login?'+q:'https://loc.lo3rwang.cc/local/settings/';\nasync function post(path,body){\n  const res=await fetch('/api/auth/'+path,{method:'POST',credentials:'include',\n    headers:{'content-type':'application/json'},body:JSON.stringify(body)});\n  const data=await res.json().catch(()=>({}));\n  if(!res.ok)throw Error(data.message||data.error||'LOC Auth failed');\n  return data;\n}\ndocument.getElementById('google').onclick=async()=>{\n  try{\n    status.textContent='正在進行 Google OAuth';\n    const data=await post('sign-in/social',{provider:'google',callbackURL:next,\n      ...(q?{oauth_query:q}:{})});\n    if(!data.url)throw Error('Google authorization URL missing');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n};\ndocument.getElementById('continue').onclick=async()=>{\n  try{\n    const data=await post('oauth2/continue',{oauth_query:q});\n    location.assign(data.url||'https://loc.lo3rwang.cc/local/settings/');\n  }catch(e){status.textContent=e.message}\n};\ndocument.getElementById('logout').onclick=async()=>{\n  try{await post('sign-out',{});location.reload()}catch(e){status.textContent=e.message}\n};\nfetch('/api/auth/get-session',{credentials:'include'}).then(r=>r.json()).then(data=>{\n  if(!data?.user)return;\n  document.getElementById('identity').textContent=data.user.email||'';\n  document.getElementById('continue').hidden=false;\n}).catch(()=>{});";
const CONSENT_JS="const q=location.search.slice(1),p=new URLSearchParams(q);\nfor(const [id,key] of [['client','client_id'],['scope','scope'],['redirect','redirect_uri']])\n  document.getElementById(id).textContent=p.get(key)||'';\nasync function consent(accept){\n  const status=document.getElementById('status');\n  try{\n    const res=await fetch('/api/auth/oauth2/consent',{method:'POST',credentials:'include',\n      headers:{'content-type':'application/json'},\n      body:JSON.stringify({accept,oauth_query:q})});\n    const data=await res.json().catch(()=>({}));\n    if(!res.ok||!data.url)throw Error(data.message||data.error||'Consent failed');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n}\ndocument.getElementById('approve').onclick=()=>consent(true);\ndocument.getElementById('deny').onclick=()=>consent(false);";
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.hostname!=='auth.lo3rwang.cc')
      return new Response('Not found',{status:404});
    const origin=request.headers.get('origin');
    if(origin&&!allowed.has(origin)&&!url.pathname.startsWith('/.well-known/'))
      return new Response('Origin denied',{status:403});
    if(request.method==='OPTIONS'){
      if(origin&&!allowed.has(origin))return new Response(null,{status:403});
      return cors(request,new Response(null,{status:204,headers:{
        'access-control-allow-methods':'GET,POST,OPTIONS',
        'access-control-allow-headers':'authorization,content-type',
        'access-control-max-age':'600'
      }}));
    }
    try{
      const auth=authFor(env);
      if(request.method==='GET'&&url.pathname==='/.well-known/oauth-authorization-server')
        return cors(request,await oauthProviderAuthServerMetadata(auth)(request),true);
      if(request.method==='GET'&&url.pathname==='/.well-known/openid-configuration')
        return cors(request,await oauthProviderOpenIdConfigMetadata(auth)(request),true);
      if(request.method==='GET'&&url.pathname==='/.well-known/jwks.json'){
        const to=new URL('/api/auth/jwks',LOC_ISSUER);
        return cors(request,await auth.handler(new Request(to,request)),true);
      }
      if(url.pathname.startsWith('/api/auth/'))
        return cors(request,await auth.handler(request));
      if(request.method==='GET'&&url.pathname==='/login')
        return page('登入',
          '<p>LOC Auth：獨立 OAuth/OIDC 身分服務。</p>'+
          '<p id="identity"></p><button id="google">使用 Google 登入</button>'+
          '<button id="continue" hidden>繼續授權</button><button id="logout">登出</button>',
          LOGIN_JS);
      if(request.method==='GET'&&url.pathname==='/consent')
        return page('授權確認',
          '<p>客戶端：<strong id="client"></strong></p>'+
          '<p>Scope：<strong id="scope"></strong></p>'+
          '<p>回呼：<strong id="redirect"></strong></p>'+
          '<p>OAuth 同意不代表 LOC 內容寫入權限。</p>'+
          '<button id="approve">核准</button><button id="deny">拒絕</button>',
          CONSENT_JS);
      if(request.method==='GET'&&url.pathname==='/health')
        return new Response(JSON.stringify({service:'LOC Auth',module:'better-auth',
          issuer:LOC_ISSUER}),{headers:{'content-type':'application/json'}});
      return new Response('Not found',{status:404});
    }catch(error){
      console.error('LOC Auth failed',error?.message||error);
      return new Response(JSON.stringify({error:'LOC Auth unavailable'}),{
        status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
      });
    }
  }
};
