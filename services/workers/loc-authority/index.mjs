// cloudflareSsoConfig is read only by the dormant probe below; it stays
// imported so re-enabling that block needs no other edit.
import {createLocAuth,cloudflareSsoConfig,LOC_ISSUER,LOC_WEB} from './auth.mjs';
import {oauthProviderAuthServerMetadata,oauthProviderOpenIdConfigMetadata,
  verifyOAuthQueryParams} from '@better-auth/oauth-provider';

// Only transport and OAuth login/consent UI remain here. No custom auth protocol.
// Build Better Auth fresh per request. Its native pg.Client connections are
// acquired and released inside the same request; never reuse sockets opened
// for an earlier request in a Cloudflare Worker isolate.
const EXTENSION='chrome-extension://hiaeafonocnjaclcfgjmdopbcgnafnna';
const allowed=new Set([LOC_ISSUER,LOC_WEB,EXTENSION]);
let lastSsoHealthProbeAt=0; // Temporary debug cooldown; remove after diagnosis.
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
// LOC Auth: user chooses Google OAuth or Cloudflare SSO.
// Google sign-up stays disabled in auth.mjs; both paths preserve the signed OAuth continuation.
const LOGIN_JS="const status=document.getElementById('status');\nconst oauth=document.getElementById('oauth');\nconst sso=document.getElementById('sso');\nconst params=new URLSearchParams(location.search);\nconst q=OAUTH_QUERY;\nconst requested=params.get('return_to')||'/local/settings/';\nconst safe=requested.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('\\\\')?requested:'/local/settings/';\nconst success=q\n  ?location.origin+'/api/auth/oauth2/authorize?'+q\n  :'https://loc.lo3rwang.cc/login/index.html?return_to='+encodeURIComponent(safe)+'&oauth_return=1';\nconst errorReturn=q?location.origin+'/login?'+q:location.origin+'/login';\nasync function begin(method){\n  oauth.disabled=true;sso.disabled=true;\n  status.textContent=method==='sso'?'正在轉往 Cloudflare Access…':'正在轉往 Google OAuth…';\n  try{\n    const endpoint=method==='sso'?'/api/auth/sign-in/sso':'/api/auth/sign-in/social';\n    const options=method==='sso'?{providerId:'cloudflare-access',callbackURL:success,errorCallbackURL:errorReturn}:{provider:'google',callbackURL:success,errorCallbackURL:errorReturn};\n    const res=await fetch(endpoint,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(options)});\n    const data=await res.json().catch(()=>({}));\n    if(!res.ok)throw Error(data.message||data.error||'登入服務無法啟動');\n    if(!data.url)throw Error('登入授權網址不存在');\n    location.replace(data.url);\n  }catch(error){\n    status.textContent=String(error?.message||'登入失敗');\n    oauth.disabled=false;sso.disabled=false;\n  }\n}\noauth.onclick=()=>begin('oauth');\nsso.onclick=()=>begin('sso');\nif(params.has('error'))status.textContent='先前登入未完成，請選擇登入方式重新嘗試。';";
const CONSENT_JS="const q=OAUTH_QUERY,p=new URLSearchParams(q);\nfor(const [id,key] of [['client','client_id'],['scope','scope'],['redirect','redirect_uri']])\n  document.getElementById(id).textContent=p.get(key)||'';\nasync function consent(accept){\n  const status=document.getElementById('status');\n  try{\n    const res=await fetch('/api/auth/oauth2/consent',{method:'POST',credentials:'include',\n      headers:{'content-type':'application/json'},\n      body:JSON.stringify({accept,scope:p.get('scope')||'',oauth_query:q})});\n    const data=await res.json().catch(()=>({}));\n    if(!res.ok||!data.url)throw Error(data.message||data.error||'Consent failed');\n    location.assign(data.url);\n  }catch(e){status.textContent=e.message}\n}\ndocument.getElementById('approve').onclick=()=>consent(true);\ndocument.getElementById('deny').onclick=()=>consent(false);";
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
          '<p>選擇 LOC Auth 登入方式</p>'+
          '<button id="oauth">OAuth（Google）</button> '+
          '<button id="sso">SSO（Cloudflare）</button>'+
          '<p id="status" role="status"></p>',
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
      // One-shot, admin-only Cloudflare Access OIDC credential and reachability check.
      // Only sanitized status/error codes are returned. No tokens, secrets, or codes are exposed.
      if(request.method==='GET'&&url.pathname==='/admin/sso-diagnostic'){
        const check=new Request(new URL('/api/auth/get-session',LOC_ISSUER),{headers:request.headers});
        const sessionResult=await getAuth().handler(check);
        const session=await sessionResult.json().catch(()=>null);
        if(session?.user?.role!=='admin')
          return new Response('Forbidden',{status:403,headers:{'cache-control':'no-store'}});
        const provider=cloudflareSsoConfig(env);
        const issuer=new URL(provider.issuer);
        const tokenPath=(issuer.pathname.endsWith('/')?issuer.pathname.slice(0,-1):issuer.pathname)+'/token';
        const tokenURL=new URL(tokenPath,issuer.origin);
        const test=async mode=>{
          const data=new URLSearchParams({
            grant_type:'authorization_code',
            code:'loc-auth-diagnostic-invalid-code',
            redirect_uri:LOC_ISSUER+'/api/auth/sso/callback/cloudflare-access'
          });
          const headers={'content-type':'application/x-www-form-urlencoded','accept':'application/json'};
          if(mode==='basic'||mode==='invalid-secret'){
            // Negative control: intentionally wrong credential, invalid code.
            const secret=mode==='invalid-secret'
              ?'loc-auth-diagnostic-deliberately-invalid-secret'
              :provider.clientSecret;
            headers.authorization='Basic '+btoa(provider.clientId+':'+secret);
          }else{
            data.set('client_id',provider.clientId);
            data.set('client_secret',provider.clientSecret);
          }
          const started=Date.now();
          try{
            const response=await fetch(tokenURL.toString(),{
              method:'POST',headers,body:data.toString(),redirect:'manual',
              signal:AbortSignal.timeout(7000)
            });
            const contentType=response.headers.get('content-type')||'';
            let error='';
            if(contentType.includes('json')){
              const payload=await response.json().catch(()=>null);
              error=typeof payload?.error==='string'?payload.error:'';
            }
            // Never expose redirect query values: they may contain auth state.
            // Only the destination host/path are needed to diagnose HTTP 302.
            let redirectTo=null;
            const location=response.headers.get('location');
            if(location){
              try{
                const destination=new URL(location,tokenURL);
                // OAuth codes, state and error descriptions must never be echoed.
                const queryNames=[...new Set(destination.searchParams.keys())].slice(0,12);
                const rawError=destination.searchParams.get('error');
                const knownErrors=new Set(['invalid_grant','invalid_client','invalid_request',
                  'unauthorized_client','access_denied','server_error','login_required']);
                redirectTo={host:destination.hostname,path:destination.pathname,
                  queryNames,error:rawError?(knownErrors.has(rawError)?rawError:'other'):null,
                  hasCode:destination.searchParams.has('code'),
                  hasState:destination.searchParams.has('state'),
                  hasErrorDescription:destination.searchParams.has('error_description')};
              }catch{redirectTo={unparseable:true};}
            }
            return {method:mode,httpStatus:response.status,
              oauthError:error.slice(0,64),elapsedMs:Date.now()-started,
              cfRayPresent:!!response.headers.get('cf-ray'),
              cfMitigated:response.headers.get('cf-mitigated')||null,
              redirectTo};
          }catch(error){
            return {method:mode,networkError:String(error?.name||'Error').slice(0,60),
              elapsedMs:Date.now()-started};
          }
        };
        const basic=await test('basic');
        const post=basic.oauthError==='invalid_grant'?null:await test('post');
        // Both responses using the same invalid code are expected to differ
        // if the provider validates client credentials before code redemption.
        const invalidSecret=await test('invalid-secret');
        return new Response(JSON.stringify({
          endpointHost:tokenURL.hostname,
          clientIdMatchesIssuer:issuer.pathname.split('/').filter(Boolean).at(-1)===provider.clientId,
          checks:[basic,...(post?[post]:[]),invalidSecret],
          note:'All requests use a deliberately invalid authorization code. The invalid-secret control also uses a deliberately incorrect Client Secret; compare its error with the genuine credential request.'
        }),{headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
      }
      // TEMPORARY SSO DEBUG MODE — ON. No Auth Session required: sign-in is
      // broken. To turn it OFF after diagnosis, enclose this entire route in
      // /* ... */. Do not remove /health, change Secrets or touch deployment CI.
      // The one-shot probe emits statuses and recognized error TYPES only.
      // Never return credentials, code, state, redirect parameters, response
      // bodies, OIDC client IDs, tokens or raw exception messages.
      if(request.method==='GET'&&url.pathname==='/health/upstream'){
        // Cloudflare version_metadata is configured in wrangler.jsonc.
        // The ID identifies the deployed Worker version, not merely the
        // package version or the GitHub main commit.
        const debugInfo={debug:'temporary',debugVersion:'sso-health-v2',
          workerVersion:String(env.CF_VERSION_METADATA?.id||'unavailable')};
        const headers={'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store, max-age=0','pragma':'no-cache',
          'x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow',
          'referrer-policy':'no-referrer'};
        const reply=(value,status=200)=>new Response(JSON.stringify(value),
          {status,headers});
        // A best-effort per-isolate cooldown limits untrusted repeated
        // invocation; there is no new KV, database or session dependency.
        const now=Date.now();
        if(now-lastSsoHealthProbeAt<120000)
          return reply({...debugInfo,error:'probe_rate_limited'},429);
        lastSsoHealthProbeAt=now;
        const started=Date.now();
        const names=['LOC_AUTH_DATABASE_URL','LOC_CONTROL_ENCRYPTION_KEY',
          'LOC_CLOUDFLARE_SSO_ISSUER','LOC_CLOUDFLARE_SSO_CLIENT_ID',
          'LOC_CLOUDFLARE_SSO_CLIENT_SECRET'];
        const keys=Object.fromEntries(names.map(name=>[
          name,String(env[name]||'').trim()?'present':'missing']));
        keys.GOOGLE_CLIENT_ID=String(env.LOC_GOOGLE_CLIENT_ID||
          env.GOOGLE_CLIENT_ID||'').trim()?'present_optional':'absent_optional';
        keys.GOOGLE_CLIENT_SECRET=String(env.LOC_GOOGLE_CLIENT_SECRET||
          env.GOOGLE_CLIENT_SECRET||'').trim()?'present_optional':'absent_optional';
        const provider=cloudflareSsoConfig(env);
        let issuer=null;
        let issuerMatchesClient=false;
        try{
          issuer=new URL(provider.issuer);
          issuerMatchesClient=issuer.protocol==='https:'&&
            issuer.pathname.startsWith('/cdn-cgi/access/sso/oidc/')&&
            issuer.pathname.split('/').filter(Boolean).at(-1)===provider.clientId;
        }catch{/* invalid configuration is reported below */}
        const config={issuerValid:!!issuer&&issuer.protocol==='https:',
          issuerMatchesClient,requiredKeysPresent:names.every(
            name=>keys[name]==='present')};
        if(!config.issuerMatchesClient||!config.requiredKeysPresent)
          return reply({...debugInfo,keys,config,
            diagnosis:'configuration_mismatch',elapsedMs:Date.now()-started});
        const endpoint=issuer.origin+issuer.pathname.replace(/\/+$/,'');
        const knownOAuthErrors=new Set(['invalid_client','invalid_grant',
          'invalid_request','unauthorized_client','access_denied',
          'unsupported_grant_type','server_error','temporarily_unavailable']);
        const safeOauthError=code=>typeof code==='string'
          ?knownOAuthErrors.has(code)?code:'other'
          :'none';
        const safeContentType=response=>String(
          response.headers.get('content-type')||'').toLowerCase()
          .includes('json')?'json':'other';
        // Only categories of a redirect are returned; Location host/path,
        // query values, OAuth code/state and credentials are never exposed.
        const redirectClass=response=>{
          if(response.status<300||response.status>=400)return null;
          const location=response.headers.get('location');
          if(!location)return {present:false};
          try{
            const target=new URL(location,endpoint+'/token');
            const path=target.pathname;
            const category=path.startsWith('/cdn-cgi/access/login')?
              'access_login':path.startsWith('/cdn-cgi/access/')?
              'access_endpoint':target.origin===issuer.origin?
              'same_origin_other':'external_other';
            return {present:true,category,
              sameOrigin:target.origin===issuer.origin,
              hasOAuthError:target.searchParams.has('error')};
          }catch{return {present:true,category:'unparseable'};}
        };
        const discoveryStarted=Date.now();
        let discovery;
        try{
          const result=await fetch(endpoint+'/.well-known/openid-configuration',{
            headers:{accept:'application/json'},redirect:'manual',
            signal:AbortSignal.timeout(5000)});
          let metadata=null;
          if(result.ok&&safeContentType(result)==='json'){
            const body=await result.text();
            if(body.length<=50000)metadata=JSON.parse(body);
          }
          discovery={httpStatus:result.status,
            elapsedMs:Date.now()-discoveryStarted,
            issuerMatches:metadata?.issuer===provider.issuer,
            tokenEndpointMatches:metadata?.token_endpoint===endpoint+'/token',
            advertisedAuthMethods:Array.isArray(
              metadata?.token_endpoint_auth_methods_supported)
              ?metadata.token_endpoint_auth_methods_supported.filter(method=>
                ['client_secret_basic','client_secret_post',
                  'private_key_jwt','none'].includes(method)).slice(0,4):[],
            contentType:safeContentType(result),
            mitigated:!!result.headers.get('cf-mitigated')};
        }catch(error){
          discovery={networkError:error?.name==='TimeoutError'?'timeout':
            'network_or_parse_error',elapsedMs:Date.now()-discoveryStarted};
        }
        // All token calls intentionally use an invalid authorization code.
        // No legitimate code, token, Session or user data is ever consumed.
        const tokenTest=async mode=>{
          const data=new URLSearchParams({grant_type:'authorization_code',
            code:'loc-sso-debug-intentionally-invalid-code',
            redirect_uri:LOC_ISSUER+'/api/auth/sso/callback/cloudflare-access'});
          const requestHeaders={'content-type':'application/x-www-form-urlencoded',
            accept:'application/json'};
          if(mode==='post'){
            data.set('client_id',provider.clientId);
            data.set('client_secret',provider.clientSecret);
          }else{
            const secret=mode==='invalid_secret'
              ?'loc-sso-debug-invalid-client-secret':provider.clientSecret;
            requestHeaders.authorization='Basic '+
              btoa(provider.clientId+':'+secret);
          }
          const start=Date.now();
          try{
            const result=await fetch(endpoint+'/token',{method:'POST',
              headers:requestHeaders,body:data.toString(),redirect:'manual',
              signal:AbortSignal.timeout(6000)});
            let oauthError='none';
            if(safeContentType(result)==='json'){
              const raw=await result.text();
              if(raw.length<=10000){
                try{oauthError=safeOauthError(JSON.parse(raw)?.error)}
                catch{oauthError='unparseable'}
              }else oauthError='oversize';
            }
            return {method:mode,httpStatus:result.status,
              oauthError,elapsedMs:Date.now()-start,
              contentType:safeContentType(result),
              redirect:redirectClass(result),
              mitigated:!!result.headers.get('cf-mitigated'),
              hasCfRay:!!result.headers.get('cf-ray')};
          }catch(error){
            return {method:mode,networkError:error?.name==='TimeoutError'
              ?'timeout':'network_error',elapsedMs:Date.now()-start};
          }
        };
        const tests=await Promise.all([
          tokenTest('basic'),tokenTest('post'),tokenTest('invalid_secret')]);
        return reply({...debugInfo,keys,config,discovery,tokenTests:tests,
          // invalid_grant from a real-secret request is compatible with
          // accepted client authentication; equal errors are inconclusive.
          diagnosis:tests.some(t=>t.method!=='invalid_secret'&&
            t.oauthError==='invalid_grant')?'client_auth_likely_accepted'
            :tests.every(t=>t.httpStatus===500)?'upstream_all_500'
            :tests.every(t=>t.httpStatus===302)?'upstream_token_redirects'
            :'compare_token_errors',
          elapsedMs:Date.now()-started});
      }
      // END TEMPORARY SSO DEBUG MODE.
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
