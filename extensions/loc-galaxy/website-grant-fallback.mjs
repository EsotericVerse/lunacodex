import {LOC_ORIGIN,verifyScopeAuthorization,mcpTool} from './oauth.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PENDING='locGalaxy.websitePending',ACTIVE='locGalaxy.websiteActive';
const SCOPE_KEY='locGalaxy.scopeid',AUTH='locGalaxy.oauth',ACCESS='locGalaxy.access';
function page(url,nonce,scopeid){
  try{const u=new URL(url);return u.origin===LOC_ORIGIN&&u.pathname==='/extension/auth-bridge.html'&&
    u.searchParams.get('nonce')===nonce&&u.searchParams.get('scopeid')===scopeid;}catch{return false;}
}
async function knownTab(record,nonce,scopeid){
  if(!record||record.nonce!==nonce||record.scopeid!==scopeid||
     !Number.isInteger(record.tabId))return false;
  try{const tab=await chrome.tabs.get(record.tabId);return page(tab.url,nonce,scopeid);}
  catch{return false;}
}
async function grant(message,sender){
  const scopeid=String(message.scopeid||''),nonce=String(message.nonce||'');
  if(!SCOPE.test(scopeid)||!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)||
     !page(sender.url,nonce,scopeid))throw Error('LOC 網站來源與授權識別不符');
  const session=await chrome.storage.session.get(PENDING);
  const local=await chrome.storage.local.get([ACTIVE,SCOPE_KEY,AUTH]);
  const now=Date.now(),pending=session[PENDING],active=local[ACTIVE];
  const initial=Boolean(pending&&now-pending.created<300000&&
    await knownTab(pending,nonce,scopeid));
  const renewal=Boolean(active&&now-active.created<86400000&&
    await knownTab(active,nonce,scopeid));
  if(!initial&&!renewal)throw Error('LOC 授權頁面不符或已過期，請從 Extension 重新連線');
  if(local[SCOPE_KEY]!==scopeid)throw Error('Extension Scope 已變更');
  const token=String(message.access_token||''),expires=Number(message.expires_at);
  if(!/^eyJ[A-Za-z0-9_-]+\./.test(token)||token.length>8192||
    !Number.isFinite(expires)||expires<now+15000||expires>now+3600000)
    throw Error('網站 MCP Token 格式或有效期不符');
  const checked=initial?await verifyScopeAuthorization(token,scopeid)
    :await mcpTool(token,'loc_connection_status');
  if(checked.provider&&checked.provider!=='clerk')
    throw Error('LOC MCP Clerk Provider 不一致');
  if(message.subject!==checked.subject)
    throw Error('LOC MCP 使用者與網站 Session 不一致');
  const previous=local[AUTH];
  if(renewal&&(!previous||previous.subject!==checked.subject||previous.scopeid!==scopeid))
    throw Error('網站續期身分或 Scope 不一致');
  await chrome.storage.local.set({
    [AUTH]:{scopeid,subject:checked.subject,client_id:'website-clerk',
      refresh_token:'',mode:'website'},
    [ACTIVE]:initial?{scopeid,nonce,tabId:pending.tabId,created:now}:active
  });
  await chrome.storage.session.set({[ACCESS]:{
    scopeid,subject:checked.subject,access_token:token,
    expires_at:expires,verified_until:now+300000
  }});
  if(initial)await chrome.storage.session.remove(PENDING);
  return {ready:true,scopeid,subject:checked.subject};
}
// Existing background handler processes senders that include sender.tab.
// This fallback only handles web-origin senders without sender.tab.
chrome.runtime.onMessageExternal.addListener((message,sender,sendResponse)=>{
  if(message?.type!=='locGalaxy.websiteGrant')return false;
  if(!page(sender.url,String(message.nonce||''),String(message.scopeid||'')))return false;
  void grant(message,sender).then(data=>sendResponse({ok:true,data}))
    .catch(error=>sendResponse({ok:false,error:String(error?.message||error).slice(0,180)}));
  return true;
});
