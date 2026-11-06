import {LOC_ORIGIN,verifyScopeAuthorization,mcpTool} from './oauth.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PENDING='locGalaxy.websitePending',ACTIVE='locGalaxy.websiteActive';
const SCOPE_KEY='locGalaxy.scopeid',AUTH='locGalaxy.oauth',ACCESS='locGalaxy.access';
function page(url,nonce,scopeid){
  try{const u=new URL(url);return u.origin===LOC_ORIGIN&&
    /^\\/extension\\/auth-bridge\\.html\\/?$/.test(u.pathname)&&
    u.searchParams.get('nonce')===nonce&&u.searchParams.get('scopeid')===scopeid;}catch{return false;}
}
// Chrome's sender URL is not an authentication URL contract. Validate the
// browser-provided origin and independently verify the extension-created tab.
function trustedSender(sender){
  if(sender?.origin!==undefined)return sender.origin===LOC_ORIGIN;
  try{return new URL(sender?.url||'').origin===LOC_ORIGIN;}catch{return false;}
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
     !trustedSender(sender))throw Error('LOC 網站來源或授權識別不符');
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
  if(message?.type!=='locGalaxy.websiteGrant'&&message?.type!=='locGalaxy.bridgeProbe')
    return false;
  // Report an explicit diagnostic for each LOC-initiated bridge request.
  // No credential or Session data is returned by the probe.
  const scopeid=String(message.scopeid||''),nonce=String(message.nonce||'');
  if(!trustedSender(sender)){
    sendResponse({ok:false,error:'Extension 收到訊息，但來源不是 LOC 官方網站'});
    return false;
  }
  if(!SCOPE.test(scopeid)||!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)){
    sendResponse({ok:false,error:'授權 nonce 或 Scope 格式無效'});
    return false;
  }
  if(message.type==='locGalaxy.bridgeProbe'){
    void (async()=>{
      const session=await chrome.storage.session.get(PENDING);
      const local=await chrome.storage.local.get([ACTIVE,SCOPE_KEY]);
      const now=Date.now(),pending=session[PENDING],active=local[ACTIVE];
      const matched=Boolean(
        (pending&&now-pending.created<300000&&await knownTab(pending,nonce,scopeid))||
        (active&&now-active.created<86400000&&await knownTab(active,nonce,scopeid)));
      if(local[SCOPE_KEY]!==scopeid)return {ok:false,error:'Extension Scope 不一致'};
      if(!matched)return {ok:false,error:'Extension 沒有匹配的授權分頁，請由 Extension 重新開始'};
      return {ok:true,data:{bridge:true,protocol:1,version:chrome.runtime.getManifest().version}};
    })().then(sendResponse)
      .catch(error=>sendResponse({ok:false,error:String(error?.message||error).slice(0,180)}));
    return true;
  }
  void grant(message,sender).then(data=>sendResponse({ok:true,data}))
    .catch(error=>sendResponse({ok:false,error:String(error?.message||error).slice(0,180)}));
  return true;
});
