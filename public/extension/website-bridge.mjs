// Website-owned Clerk session bridge. Only issues audience-bound short-lived JWT templates.
// Never send the site's default session JWT or cookie to a Chrome extension.
const EXTENSION_ID='hiaeafonocnjaclcfgjmdopbcgnafnna';
const ISSUER='https://precise-grackle-3371.clerk.accounts.dev';
const RESOURCE='https://loc.lo3rwang.cc/mcp';
const TEMPLATE='loc-mcp';
const byId=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const nonce=params.get('nonce')||'';
const scopeid=params.get('scopeid')||'';
const valid=/^[a-z][a-z0-9]{0,14}$/.test(scopeid)&&/^[A-Za-z0-9_-]{32,128}$/.test(nonce);
let currentClerk=null,connectFlight=null,approved=false,nextRenewAt=0;
function status(message){byId('status').textContent=message;}
function decodeClaims(token){
  const part=token.split('.')[1];
  if(!part)return null;
  return JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
}
async function loadScript(src,attributes={}){
  await new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=src;el.async=true;el.crossOrigin='anonymous';
    for(const [name,value] of Object.entries(attributes))el.setAttribute(name,value);
    el.onload=resolve;el.onerror=()=>reject(new Error('Clerk 元件載入失敗'));
    document.head.append(el);
  });
}
async function loadClerk(){
  if(currentClerk)return currentClerk;
  const res=await fetch('/recovery/config.json',{cache:'no-store'});
  if(!res.ok)throw Error('LOC 網站登入設定無法讀取');
  const config=await res.json();
  if(new URL(config.frontendApiUrl).origin!==ISSUER||!config.publishableKey)
    throw Error('Clerk 網站登入來源不一致');
  await loadScript(ISSUER+'/npm/@clerk/ui@1/dist/ui.browser.js');
  await loadScript(ISSUER+'/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
    {'data-clerk-publishable-key':config.publishableKey});
  const clerk=window.Clerk;
  if(!clerk)throw Error('LOC 網站 Clerk 未初始化');
  await clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});
  currentClerk=clerk;
  return clerk;
}
async function connect(){
  if(connectFlight)return connectFlight;
  const flight=connectOnce();
  connectFlight=flight;
  try{return await flight;}
  finally{if(connectFlight===flight)connectFlight=null;}
}
async function connectOnce(){
  if(!valid)throw Error('Extension 授權請求無效，請從 Extension 重新連線');
  status('正在確認 Extension 訊息通道…');
  if(!globalThis.chrome?.runtime?.sendMessage)
    throw Error('Chrome 未提供外部 Extension 訊息通道');
  const probe=await new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage(EXTENSION_ID,{type:'locGalaxy.bridgeProbe',nonce,scopeid},answer=>{
      const err=chrome.runtime.lastError?.message;
      if(err)reject(Error('Chrome 傳訊失敗：'+err));
      else resolve(answer);
    });
  });
  if(!probe||typeof probe!=='object')
    throw Error('Chrome 沒有取得 Extension 監聽器的回覆（可能是 Service Worker 未啟動）');
  if(!probe.ok)throw Error('Extension 通道核對失敗：'+String(probe.error||'沒有原因'));
  if(probe.data?.bridge!==true)throw Error('Extension 通道回應格式不符');
  if(probe.data?.protocol!==1)
    throw Error('Extension 授權協定不符（目前版本 '+String(probe.data?.version||'未知')+'；至少需要 0.6.3）');
  status('訊息通道正常，正在確認已登入的 LOC Session…');
  const clerk=await loadClerk();
  if(!clerk.isSignedIn||!clerk.session||!clerk.user){
    const back='/extension/auth-bridge.html?scopeid='+encodeURIComponent(scopeid)+
      '&nonce='+encodeURIComponent(nonce);
    byId('login').href='/login/index.html?return_to='+encodeURIComponent(back);
    byId('signin').hidden=false;
    throw Error('尚未登入 LOC 網站，請先完成 Clerk 登入再返回此頁');
  }
  status('LOC 已登入，正在取得專用授權…');
  const token=await clerk.session.getToken({template:TEMPLATE,skipCache:true});
  if(typeof token!=='string'||!token)throw Error('Clerk 未核發 loc-mcp JWT Template；請檢查 Clerk Dashboard 設定');
  const claims=decodeClaims(token),now=Math.floor(Date.now()/1000);
  if(claims?.iss!==ISSUER||claims?.sub!==clerk.user.id||
    !(Array.isArray(claims.aud)?claims.aud.includes(RESOURCE):claims.aud===RESOURCE)||
    !Number.isInteger(claims.exp)||claims.exp<=now+15||
    claims.exp>now+3600)
    throw Error('Clerk 專用 Token 的 issuer、audience、使用者或有效期限不符');
  // Only a narrowly audience-bound token is handed to the trusted extension.
  // The extension independently verifies the token and Scope with LOC MCP.
  if(!globalThis.chrome?.runtime?.sendMessage)
    throw Error('Chrome 找不到 LOC Galaxy Extension 的網站通訊介面，請在 chrome://extensions 重新載入 Extension');
  let reply;
  try{
    // External webpages cannot infer whether the installed extension has
    // reloaded from a merged GitHub commit. The callback exposes Chrome's
    // concrete delivery failure instead of turning it into "Scope denied".
    reply=await new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage(EXTENSION_ID,{
        type:'locGalaxy.websiteGrant',nonce,scopeid,
        access_token:token,expires_at:claims.exp*1000,subject:claims.sub
      },answer=>{
        const failure=chrome.runtime.lastError?.message;
        if(failure)reject(Error(failure));
        else resolve(answer);
      });
    });
  }catch(error){
    throw Error('Chrome Extension 通訊失敗：'+String(error?.message||error).slice(0,180)+
      '。請確認已更新本機擴充功能檔案並重新載入，而非僅重新整理網站');
  }
  if(!reply||typeof reply!=='object')
    throw Error('Extension 收到前置探測，但沒有回覆網站授權要求，請檢查 Service Worker 錯誤');
  if(!reply.ok)throw Error(reply.error||'Extension 拒絕網站授權訊息（未提供原因）');
  if(reply.data?.ready!==true)
    throw Error('Extension 已收到授權，但 Scope 核驗未完成');
  approved=true;
  // Clerk loc-mcp templates can last only one minute. Renew before the
  // Extension's 15-second safety margin, not at a fixed 45-second interval.
  nextRenewAt=claims.exp*1000-35000;
  status('已由 LOC 網站 Session 完成 Galaxy 授權。請保留此分頁以自動續期；可切換回 ChatGPT。');
}
byId('retry').addEventListener('click',()=>{void connect().catch(error=>status(String(error.message||error)));});
void connect().catch(error=>status(String(error.message||error)));

// Clerk template tokens are short-lived. While this trusted site tab remains open,
// renew the dedicated audience-bound grant without asking for interactive OAuth.
function renewWhenDue(){
  if(!approved||Date.now()<nextRenewAt||connectFlight)return;
  void connect().catch(error=>status('授權續期失敗：'+String(error.message||error)));
}
// The timer checks readiness only; it does not request JWTs every eight seconds.
// Recover as soon as the browser foregrounds a throttled authorization page.
setInterval(renewWhenDue,8000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renewWhenDue();});
window.addEventListener('focus',renewWhenDue);
window.addEventListener('locGalaxy.websiteRenew',renewWhenDue);
