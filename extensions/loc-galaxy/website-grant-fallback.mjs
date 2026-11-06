import {LOC_ORIGIN,verifyScopeAuthorization,mcpTool} from './oauth.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PENDING='locGalaxy.websitePending',ACTIVE='locGalaxy.websiteActive';
const SCOPE_KEY='locGalaxy.scopeid',AUTH='locGalaxy.oauth',ACCESS='locGalaxy.access';
function page(url,nonce,scopeid){
  try{const u=new URL(url);return u.origin===LOC_ORIGIN&&
    (u.pathname==='/extension/auth-bridge.html'||u.pathname==='/extension/auth-bridge.html/')&&
    u.searchParams.get('nonce')===nonce&&u.searchParams.get('scopeid')===scopeid;}catch{return false;}
}
// Chrome's sender URL is not an authentication URL contract. Validate the
// browser-provided origin and independently verify the extension-created tab.
function trustedSender(sender){
  if(sender?.origin!==undefined)return sender.origin===LOC_ORIGIN;
  try{return new URL(sender?.url||'').origin===LOC_ORIGIN;}catch{return false;}
}
function validGrant(record,nonce,scopeid,now,maxAge,sender){
  if(!record||record.nonce!==nonce||record.scopeid!==scopeid||
     !Number.isFinite(record.created)||record.created>now||
     now-record.created>=maxAge)return false;
  // The original tab ID is a supplementary check only when Chrome supplies
  // it; a webpage external message may not include sender.tab.
  return !Number.isInteger(sender?.tab?.id)||record.tabId===sender.tab.id;
}
async function grant(message,sender){
  const scopeid=String(message.scopeid||''),nonce=String(message.nonce||'');
  if(!SCOPE.test(scopeid)||!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)||
     !trustedSender(sender))throw Error('LOC 網站來源或授權識別不符');
  const session=await chrome.storage.session.get(PENDING);
  const local=await chrome.storage.local.get([ACTIVE,SCOPE_KEY,AUTH]);
  const now=Date.now(),pending=session[PENDING],active=local[ACTIVE];
  const initial=validGrant(pending,nonce,scopeid,now,300000,sender);
  const renewal=validGrant(active,nonce,scopeid,now,86400000,sender);
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
  await chrome.alarms.create('locGalaxy.websiteRenew',{periodInMinutes:0.5});
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
        validGrant(pending,nonce,scopeid,now,300000,sender)||
        validGrant(active,nonce,scopeid,now,86400000,sender));
      if(local[SCOPE_KEY]!==scopeid)return {ok:false,error:'Extension Scope 不一致'};
      if(!matched)return {ok:false,error:pending||active?
        'Extension 授權 nonce、Scope 或有效期限不一致，請由 Extension 重新開始':
        'Extension 沒有待處理的授權請求，請從 Extension 開啟新的授權頁'};
      return {ok:true,data:{bridge:true,protocol:1,version:chrome.runtime.getManifest().version}};
    })().then(sendResponse)
      .catch(error=>sendResponse({ok:false,error:String(error?.message||error).slice(0,180)}));
    return true;
  }
  void grant(message,sender).then(data=>sendResponse({ok:true,data}))
    .catch(error=>sendResponse({ok:false,error:String(error?.message||error).slice(0,180)}));
  return true;
});
