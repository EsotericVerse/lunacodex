// cloudflareSsoConfig is read only by the dormant probe below; it stays
// imported so re-enabling that block needs no other edit.
import {createLocAuth,cloudflareSsoConfig,LOC_ISSUER,LOC_WEB} from './auth.mjs';
import {oauthProviderAuthServerMetadata,oauthProviderOpenIdConfigMetadata,
  verifyOAuthQueryParams} from '@better-auth/oauth-provider';

// Only transport and OAuth login/consent UI remain here. No custom auth protocol.
// Build Better Auth fresh per request. Cloudflare Workers forbid reusing a
// socket opened in one request from another, so a memoized pool would make the
// Neon serverless WebSocket throw "Cannot perform I/O on behalf of a different
// request" (surfacing as an uncaught 1101) once an isolate reuses a pooled
// connection. Each request gets its own pool, closed after the response.
const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const allowed=new Set([LOC_ISSUER,LOC_WEB,EXTENSION]);
// OAuth clients on OTHER domains exchange their own authorization code using
// PKCE. These are standard bearer-based endpoints, never cookie/session APIs.
const publicOAuthPaths=new Set([
  '/api/auth/oauth2/register','/api/auth/oauth2/token',
  '/api/auth/oauth2/revoke','/api/auth/oauth2/userinfo'
]);
// Both RFC 8414 issuer-path metadata and OIDC issuer-local discovery
// must remain public without sharing browser Session cookies.
const isPublicProtocolPath=path=>publicOAuthPaths.has(path)||
  path.startsWith('/.well-known/')||
  path==='/api/auth/.well-known/openid-configuration'||
  path==='/api/auth/.well-known/oauth-authorization-server';

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
function page(title,content,script,signedQuery=''){
  // Inject only the *verified* Better Auth signed query, never arbitrary URLs.
  const initial='const OAUTH_QUERY='+JSON.stringify(signedQuery).replace(/</g,'\\u003c')+';'+String.fromCharCode(10);
  script=initial+script;
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
const LOGIN_JS="const status=document.getElementById('status');\nconst params=new URLSearchParams(location.search);\nconst q=OAUTH_QUERY;\nconst requested=params.get('return_to')||'/local/settings/';\nconst safe=requested.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('\\\\')?requested:'/local/settings/';\nconst next=q?location.origin+'/login?'+q:'https://loc.lo3rwang.cc/login/index.html?return_to='+encodeURIComponent(safe)+'&oauth_return=1';\nasync function post(path,body){\n  const res=await fetch('/api/auth/'+path,{method:'POST',credentials:'include',\n    headers:{'content-type':'application/json'},body:JSON.stringify(body)});\n  const data=await res.json().catch(()=>({}));\n  if(!res.ok)throw Error(data.message||data.error||'LOC Auth failed');\n  return data;\n}\ndocument.getElementById('cloudflare').onclick=async()=>{\n  try{\n    status.textContent='正在進行 Cloudflare SSO';\n    const data=await post('sign-in/sso',{providerId:'cloudflare-access',\n      callbackURL:next,errorCallbackURL:next});\n    if(!data.url)throw Error('Cloudflare SSO authorization URL missing');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n};\ndocument.getElementById('google').onclick=async()=>{\n  try{\n    status.textContent='正在進行 Google 登入';\n    const data=await post('sign-in/social',{provider:'google',callbackURL:next,\n      ...(q?{oauth_query:q}:{})});\n    if(!data.url)throw Error('Google authorization URL missing');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n};\ndocument.getElementById('continue').onclick=async()=>{\n  try{\n    if(!q)throw Error('No pending OAuth request');\n    location.assign('/api/auth/oauth2/authorize?'+q);\n  }catch(e){status.textContent=e.message}\n};\ndocument.getElementById('logout').onclick=async()=>{\n  try{await post('sign-out',{});location.reload()}catch(e){status.textContent=e.message}\n};\nfetch('/api/auth/get-session',{credentials:'include'}).then(r=>r.json()).then(data=>{\n  if(!data?.user)return;\n  if(!q){location.assign(next);return;}\n  document.getElementById('identity').textContent=data.user.email||'';\n  document.getElementById('continue').hidden=false;\n}).catch(()=>{});";
const CONSENT_JS="const q=OAUTH_QUERY,p=new URLSearchParams(q);\nfor(const [id,key] of [['client','client_id'],['scope','scope'],['redirect','redirect_uri']])\n  document.getElementById(id).textContent=p.get(key)||'';\nasync function consent(accept){\n  const status=document.getElementById('status');\n  try{\n    const res=await fetch('/api/auth/oauth2/consent',{method:'POST',credentials:'include',\n      headers:{'content-type':'application/json',accept:'application/json'},\n      body:JSON.stringify({accept,scope:p.get('scope')||'',oauth_query:q})});\n    const data=await res.json().catch(()=>({}));\n    if(!res.ok){\n      const code=[data.error,data.code].find(v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v));\n      throw Error('LOC OAuth 授權失敗（HTTP '+res.status+'）'+(code?'：'+code:''));\n    }\n    if(typeof data.url!=='string'||!data.url)throw Error('LOC OAuth 未回傳授權回呼');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n}\ndocument.getElementById('approve').onclick=()=>consent(true);\ndocument.getElementById('deny').onclick=()=>consent(false);";
// Owner-only user whitelist console. Served at /admin; the GET route verifies
// an admin session before this page is ever returned, and every button below
// calls an /api/auth/admin/* endpoint that Better Auth re-checks for the admin
// role, so the page is a convenience, not the security boundary.
//
// This console belongs to LOC Auth and touches only public.rainbow_* through
// Better Auth. It is NOT LOC Web: LOC Web owns its own business tables and
// api.manage, and the two sides share a repository, not a store. Do not reach
// across that line from here, and do not add a user-management surface for this
// on the LOC Web side — the split exists so one side cannot quietly reshape the
// other.
//
// The data model, so a later reader does not "fix" it by inventing storage:
//   identity   -> the existing rainbow_auth row (created here, or linked on
//                 first Google login to an email that already exists)
//   tier       -> the existing `role` column: admin / scope / user. No note or
//                 description column was added on purpose; role carries it.
//   blacklist  -> the admin plugin's built-in `banned` boolean, which already
//                 drops sessions and blocks login. Not a role, not a new table.
//   whitelist  -> Google has disableSignUp:true (see auth.mjs), so only emails
//                 the owner pre-creates here can ever sign in. Deleting a row
//                 revokes access; there is nothing else to turn off.
// There is no D1, KV, R2 or extra table behind any of this, and adding one is a
// decision only the user states, never an inference from this file.
const ADMIN_CONTENT='<p>使用者白名單（僅管理者可見）。建立 email 後該帳號才能登入，刪除即撤銷。</p>'+
  '<p><input id="email" type="email" placeholder="someone@gmail.com" style="padding:10px;width:55%">'+
  ' <select id="newrole" style="padding:10px"><option value="user">user</option>'+
  '<option value="scope">scope</option><option value="admin">admin</option></select>'+
  ' <button id="add">新增</button></p>'+
  '<table style="width:100%;border-collapse:collapse"><thead><tr>'+
  '<th align="left">Email</th><th align="left">角色</th>'+
  '<th align="left">狀態</th><th align="left">操作</th></tr></thead>'+
  '<tbody id="rows"></tbody></table>';
const ADMIN_JS=`
const S=document.getElementById('status');
async function api(path,opts){
  const r=await fetch('/api/auth/admin/'+path,Object.assign({credentials:'include',headers:{'content-type':'application/json'}},opts||{}));
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.message||d.error||'操作失敗');
  return d;
}
function roleSelect(id,role){
  const opts=['admin','scope','user'].map(x=>'<option value="'+x+'"'+(x===role?' selected':'')+'>'+x+'</option>').join('');
  return '<select data-id="'+id+'" class="role" style="padding:6px">'+opts+'</select>';
}
async function load(){
  S.textContent='載入中…';
  try{
    const d=await api('list-users?limit=200',{method:'GET'});
    const users=d.users||[];
    document.getElementById('rows').innerHTML=users.length?users.map(function(u){
      return '<tr><td>'+u.email+'</td><td>'+roleSelect(u.id,u.role||'user')+
        '</td><td>'+(u.banned?'已封鎖':'正常')+
        '</td><td><button data-id="'+u.id+'" class="ban" style="margin-right:6px">'+(u.banned?'解封':'封鎖')+
        '</button><button data-id="'+u.id+'" data-email="'+u.email+'" class="del">刪除</button></td></tr>';
    }).join(''):'<tr><td colspan="4">目前沒有使用者</td></tr>';
    S.textContent='共 '+users.length+' 人';
    bind();
  }catch(e){S.textContent=e.message}
}
function bind(){
  document.querySelectorAll('select.role').forEach(function(el){el.onchange=async function(){
    try{await api('set-role',{method:'POST',body:JSON.stringify({userId:el.dataset.id,role:el.value})});S.textContent='角色已更新：'+el.value;}
    catch(e){S.textContent=e.message;load();}
  };});
  document.querySelectorAll('button.ban').forEach(function(el){el.onclick=async function(){
    const banning=el.textContent==='封鎖';
    try{await api(banning?'ban-user':'unban-user',{method:'POST',body:JSON.stringify({userId:el.dataset.id})});load();}
    catch(e){S.textContent=e.message}
  };});
  document.querySelectorAll('button.del').forEach(function(el){el.onclick=async function(){
    if(!confirm('刪除 '+el.dataset.email+'？此動作無法復原。'))return;
    try{await api('remove-user',{method:'POST',body:JSON.stringify({userId:el.dataset.id})});load();}
    catch(e){S.textContent=e.message}
  };});
}
document.getElementById('add').onclick=async function(){
  const email=document.getElementById('email').value.trim().toLowerCase();
  const role=document.getElementById('newrole').value;
  if(!email||!email.endsWith('@gmail.com')||email.split('@').length!==2){S.textContent='只接受有效的 @gmail.com';return;}
  try{
    await api('create-user',{method:'POST',body:JSON.stringify({email:email,name:email,role:role})});
    document.getElementById('email').value='';
    load();
  }catch(e){S.textContent=e.message}
};
load();
`;
export default {
  async fetch(request,env,ctx){
    let pool;
    try{
    const url=new URL(request.url);
    if(url.hostname!=='auth.lo3rwang.cc')
      return new Response('Not found',{status:404});
    const origin=request.headers.get('origin');
    const publicProtocol=isPublicProtocolPath(url.pathname);
    if(origin&&!allowed.has(origin)&&!publicProtocol)
      return new Response('Origin denied',{status:403});
    if(request.method==='OPTIONS'){
      if(origin&&!allowed.has(origin)&&!publicProtocol)
        return new Response(null,{status:403});
      return cors(request,new Response(null,{status:204,headers:{
        'access-control-allow-methods':'GET,POST,OPTIONS',
        'access-control-allow-headers':'authorization,content-type',
        'access-control-max-age':'600'
      }}),publicProtocol);
    }
    try{
      // Build Better Auth (and its database pool) only for routes that use it,
      // so /login, /health and 404s never open a database connection.
      let built;
      const getAuth=()=>{
        if(!built){built=createLocAuth(env);pool=built.pool;}
        return built.auth;
      };
      if(request.method==='GET'&&(
        url.pathname==='/.well-known/oauth-authorization-server'||
        url.pathname==='/.well-known/oauth-authorization-server/api/auth'||
        url.pathname==='/api/auth/.well-known/oauth-authorization-server'))
        return cors(request,await oauthProviderAuthServerMetadata(getAuth())(request),true);
      if(request.method==='GET'&&(
        url.pathname==='/.well-known/openid-configuration'||
        url.pathname==='/api/auth/.well-known/openid-configuration'||
        url.pathname==='/.well-known/openid-configuration/api/auth'))
        return cors(request,await oauthProviderOpenIdConfigMetadata(getAuth())(request),true);
      if(request.method==='GET'&&url.pathname==='/.well-known/jwks.json'){
        const to=new URL('/api/auth/jwks',LOC_ISSUER);
        return cors(request,await getAuth().handler(new Request(to,request)),true);
      }
      if(url.pathname.startsWith('/api/auth/'))
        return cors(request,await getAuth().handler(request),publicProtocol);
      // Official plugin validates the OAuth request signature; LOC does not
      // implement a second signature/session/PKCE verification algorithm.
      let signedQuery='';
      if(url.searchParams.has('sig')||url.searchParams.has('ba_param')){
        const allowedKeys=new Set(['sig','ba_param',...url.searchParams.getAll('ba_param')]);
        signedQuery=new URLSearchParams([...url.searchParams].filter(([key])=>
          allowedKeys.has(key))).toString();
        const context=await getAuth().$context;
        if(!await verifyOAuthQueryParams(signedQuery,context.secret))
          return new Response('Invalid OAuth request',{status:400});
      }
      if(url.pathname==='/consent'&&!signedQuery)
        return new Response('Signed OAuth request required',{status:400});
      if(request.method==='GET'&&url.pathname==='/login')
        return page('登入',
          '<p>LOC Auth：SSO／OAuth／OIDC 身分服務。</p>'+
          '<p id="identity"></p><button id="cloudflare">使用 Cloudflare SSO 登入</button>'+
          '<button id="google">使用 Google 登入</button>'+
          '<button id="continue" hidden>繼續授權</button><button id="logout">登出</button>',
          LOGIN_JS,signedQuery);
      if(request.method==='GET'&&url.pathname==='/consent')
        return page('授權確認',
          '<p>客戶端：<strong id="client"></strong></p>'+
          '<p>Scope：<strong id="scope"></strong></p>'+
          '<p>回呼：<strong id="redirect"></strong></p>'+
          '<p>OAuth 同意不代表 LOC 內容寫入權限。</p>'+
          '<button id="approve">核准</button><button id="deny">拒絕</button>',
          CONSENT_JS,signedQuery);
      // Owner/admin console. Gate on the session server-side before serving a
      // single byte: anyone without an admin session is bounced to /login,
      // never shown the page. The admin/* endpoints the page calls are
      // independently admin-gated by Better Auth, so this is defence in depth.
      if(request.method==='GET'&&url.pathname==='/admin'){
        const probe=new Request(new URL('/api/auth/get-session',LOC_ISSUER),{
          headers:request.headers});
        const sres=await getAuth().handler(probe);
        const sdata=await sres.json().catch(()=>null);
        if(!sdata||!sdata.user||sdata.user.role!=='admin')
          return Response.redirect(LOC_ISSUER+'/login',302);
        return page('使用者管理',ADMIN_CONTENT,ADMIN_JS,'');
      }
      // DORMANT PROBE — kept, not deleted. Uncomment the block below to serve
      // GET /health/upstream again, which reports what one subrequest to the
      // delegated provider's discovery document actually does: status,
      // server, cf-ray, cf-mitigated, location, content type and first bytes,
      // or the error name, plus a timed node:dns lookup and the plugin's own
      // discoverOIDCConfig. It answered the question it was built for — the
      // connection to that host succeeds in about half a second on one
      // attempt and never answers on the next, which is why sign-in no longer
      // fetches discovery at all — and it is left here because the same
      // intermittency can still surface during the token exchange, and
      // measuring beats guessing. It opens no database connection, carries no
      // credential, and returns only that public document's own response.
      /*
      if(request.method==='GET'&&url.pathname==='/health/upstream'){
        const issuer=String(cloudflareSsoConfig(env).issuer||'').replace(/\/+$/,'');
        if(!issuer)return new Response(JSON.stringify({error:'No upstream issuer configured'}),
          {status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
        const target=issuer+'/.well-known/openid-configuration';
        const started=Date.now();
        let probe;
        try{
          const upstream=await fetch(target,{method:'GET',redirect:'manual',
            headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
          const body=await upstream.text();
          probe={reached:true,status:upstream.status,
            server:upstream.headers.get('server')||'',
            cfRay:upstream.headers.get('cf-ray')||'',
            cfMitigated:upstream.headers.get('cf-mitigated')||'',
            location:upstream.headers.get('location')||'',
            contentType:upstream.headers.get('content-type')||'',
            bytes:body.length,bodyStart:body.slice(0,180)};
        }catch(error){
          probe={reached:false,name:error?.name||'Error',
            message:String(error?.message||error).slice(0,180)};
        }
        // The plain fetch above already answered 200 in well under a second,
        // so the destination is reachable and the hang is inside the plugin's
        // own path. That path adds two things: an SSRF guard that may call
        // node:dns, and betterFetch instead of fetch. Time both separately so
        // the next change is aimed at whichever one actually stalls.
        let dnsProbe;
        const dnsStarted=Date.now();
        try{
          const dns=await import('node:dns/promises');
          const resolved=await Promise.race([
            dns.lookup(new URL(target).hostname,{all:true}),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('dns.lookup did not settle in 5s')),5000))
          ]);
          dnsProbe={ok:true,addresses:(resolved||[]).map(r=>r.address).slice(0,4)};
        }catch(error){
          dnsProbe={ok:false,message:String(error?.message||error).slice(0,140)};
        }
        dnsProbe.elapsedMs=Date.now()-dnsStarted;

        let pluginProbe;
        const pluginStarted=Date.now();
        try{
          const {discoverOIDCConfig}=await import('@better-auth/sso');
          const config=await discoverOIDCConfig({issuer,timeout:5000,
            isTrustedOrigin:()=>true});
          pluginProbe={ok:true,tokenEndpoint:String(config?.tokenEndpoint||''),
            jwksEndpoint:String(config?.jwksEndpoint||'')};
        }catch(error){
          pluginProbe={ok:false,name:error?.name||'Error',
            code:String(error?.code||''),
            message:String(error?.message||error).slice(0,180)};
        }
        pluginProbe.elapsedMs=Date.now()-pluginStarted;

        return new Response(JSON.stringify({host:new URL(target).host,
          plainFetch:{elapsedMs:Date.now()-started,...probe},
          dns:dnsProbe,pluginDiscovery:pluginProbe},null,1),
          {headers:{'content-type':'application/json','cache-control':'no-store'}});
      }
      */
      if(request.method==='GET'&&url.pathname==='/health')
        return new Response(JSON.stringify({service:'LOC Auth',module:'better-auth',
          issuer:LOC_ISSUER}),{headers:{'content-type':'application/json'}});
      return new Response('Not found',{status:404});
    }catch(error){
      console.error('LOC Auth failed',error?.stack||error?.message||error);
      return new Response(JSON.stringify({error:'LOC Auth unavailable'}),{
        status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
      });
    }
    }catch(fatal){
      console.error('LOC Auth fatal',fatal?.stack||fatal?.message||fatal);
      return new Response(JSON.stringify({error:'LOC Auth fatal'}),{
        status:500,headers:{'content-type':'application/json','cache-control':'no-store'}
      });
    }finally{
      if(pool){
        const closing=pool.end().catch(()=>{});
        if(ctx&&typeof ctx.waitUntil==='function')ctx.waitUntil(closing);
      }
    }
  }
};
