// OAuth callback only. The upstream access token is never persisted or put
// in a cookie, URL query, network log, extension message or local storage.
const status=document.getElementById('oauth-status');
const state=new URLSearchParams(location.search).get('state')||'';
const fragment=new URLSearchParams(location.hash.slice(1));
const access_token=fragment.get('access_token')||'';
const providerError=fragment.get('error_description')||fragment.get('error')||
 new URLSearchParams(location.search).get('error')||'';
// Remove OAuth tokens and state from the browser's address bar immediately.
history.replaceState(null,'','/login/supabase-callback.html');
(async()=>{
 try{
  if(providerError||!/^[A-Za-z0-9_-]{43,128}$/.test(state)||
    access_token.length<100||access_token.length>8192||
    access_token.split('.').length!==3)
   throw Error('Google OAuth 身分核驗未完成');
  const response=await fetch('https://auth.lo3rwang.cc/oauth/callback/supabase',{
   method:'POST',credentials:'include',cache:'no-store',
   headers:{'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({state,access_token}),
   signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error('LOC Google 身分核驗失敗');
  const data=await response.json();
  const next=new URL(String(data.next||''));
  if(!['https://auth.lo3rwang.cc','https://loc.lo3rwang.cc'].includes(next.origin))
   throw Error('LOC OAuth 返回位置不合法');
  status.textContent='核驗成功，正在返回 LOC…';
  location.replace(next.href);
 }catch(error){
  status.textContent=String(error?.message||'Google 身分核驗未完成')+
   '。請返回 LOC 重新登入。';
 }
})();
