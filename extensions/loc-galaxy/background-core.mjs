import {
  LOC_ORIGIN,randomUrlSafe,refreshAuthorization,
  verifyScopeAuthorization,mcpTool
} from './oauth.mjs';
import {scopeManagementUrl} from './workspace-routes.mjs';
import {validateConversation} from './recorder.mjs';
import {captureController} from './capture-manager.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SCOPE_KEY='locGalaxy.scopeid';
const OAUTH_KEY='locGalaxy.oauth';
const ACCESS_KEY='locGalaxy.access';
const BRIDGE_KEY='locGalaxy.websitePending';
const BRIDGE_ACTIVE_KEY='locGalaxy.websiteActive';
const WEBSITE_RENEW_ALARM='locGalaxy.websiteRenew';
const SCENIC_LOGIN=LOC_ORIGIN+'/login/index.html?return_to=%2Flocal%2Fsettings%2F';
let inProgress=false;
const linkSearchStarted=new Map();

async function protectStorage(){
  // Tokens may only be read from extension's trusted contexts.
  await Promise.all([
    chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  ]);
}
function checkedScope(value){
  if(!SCOPE.test(String(value||'')))throw Error('Scope ID 格式不正確');
  return value;
}
async function readAll(){
  const [local,session]=await Promise.all([
    chrome.storage.local.get([SCOPE_KEY,OAUTH_KEY]),
    chrome.storage.session.get([ACCESS_KEY])
  ]);
  return {scopeid:local[SCOPE_KEY]||'',
    auth:local[OAUTH_KEY]||null,access:session[ACCESS_KEY]||null};
}
async function clearCredentials(){
  await chrome.alarms.clear(WEBSITE_RENEW_ALARM);
  await Promise.all([
    chrome.storage.local.remove([OAUTH_KEY,BRIDGE_ACTIVE_KEY]),
    chrome.storage.session.remove([ACCESS_KEY,BRIDGE_KEY])
  ]);
}
async function selectScope(scopeid){
  const next=checkedScope(scopeid);
  const state=await readAll();
  if(state.scopeid!==next){
    await capture.clearOnScopeChange();
    await clearCredentials();
    await chrome.storage.local.set({[SCOPE_KEY]:next});
  }
  return next;
}
async function commitAuthorization(scopeid,issued,subject){
  if((await readAll()).scopeid!==scopeid)
    throw Error('Scope 已變更，授權結果不再有效');
  const auth={scopeid,subject,client_id:issued.client_id,
    refresh_token:issued.refresh_token||''};
  await chrome.storage.local.set({[OAUTH_KEY]:auth});
  await chrome.storage.session.set({[ACCESS_KEY]:{
    scopeid,subject,access_token:issued.access_token,
    expires_at:issued.expires_at,verified_until:Date.now()+5*60000
  }});
}
let statusFlight=null;
async function authorizedStatus(){
  if(statusFlight)return statusFlight;
  const flight=checkAuthorizedStatus();
  statusFlight=flight;
  try{return await flight;}
  finally{if(statusFlight===flight)statusFlight=null;}
}
async function checkAuthorizedStatus(){
  const {scopeid,auth,access}=await readAll();
  if(!scopeid)return {ready:false,scopeid:'',subject:''};
  if(!auth||auth.scopeid!==scopeid)
    return {ready:false,scopeid,subject:''};
  if(auth.mode==='website'){
    const binding=(await chrome.storage.local.get(BRIDGE_ACTIVE_KEY))[BRIDGE_ACTIVE_KEY];
    return binding?.scopeid===scopeid&&binding.nonce&&binding.tabId
      ?{ready:true,scopeid,subject:auth.subject,renew_on_demand:true}
      :{ready:false,scopeid,subject:'',website_session_expired:true};
  }
  try{
    if(access?.scopeid===scopeid&&
      Number(access.expires_at)>Date.now()+15_000&&
      Number(access.verified_until)>Date.now())
      return {ready:true,scopeid,subject:access.subject};
    let issued;
    // Website-minted JWTs cannot be renewed using an OAuth refresh token.
    // Do not mistake a still-valid 60-second JWT for a stale grant.
    if(auth.mode==='website')
      return {ready:false,scopeid,subject:'',website_session_expired:true,
        expires_at:Number(access?.expires_at)||null};
    if(access?.scopeid===scopeid&&Number(access.expires_at)>Date.now()+15_000)
      issued={...access,client_id:auth.client_id,
        refresh_token:auth.refresh_token};
    else issued=await refreshAuthorization(auth);
    const checked=await verifyScopeAuthorization(issued.access_token,scopeid);
    await commitAuthorization(scopeid,issued,checked.subject);
    return {ready:true,scopeid,subject:checked.subject};
  }catch(error){
    const detail=String(error?.message||'');
    const denied=/HTTP 401|HTTP 403|OAuth Session 需重新登入|Scope 核驗失敗|Clerk OAuth 身分/.test(detail);
    // Do not discard a valid refresh grant because Wi-Fi or the server is down.
    if(denied)await clearCredentials();
    return {ready:false,scopeid,subject:'',temporary_unavailable:!denied};
  }
}


// On-demand Clerk grants: no periodic wakeup, token mint or reauthorization.
let renewalFlight=null,renewalBlockedUntil=0;
async function renewWebsiteAccess(scopeid){
  if(renewalFlight)return renewalFlight;
  if(Date.now()<renewalBlockedUntil)
    throw Error('Clerk 授權暫時冷卻中；請稍後再操作');
  const flight=(async()=>{
    const local=await chrome.storage.local.get([BRIDGE_ACTIVE_KEY,OAUTH_KEY,SCOPE_KEY]);
    const binding=local[BRIDGE_ACTIVE_KEY],auth=local[OAUTH_KEY];
    if(auth?.mode!=='website'||binding?.scopeid!==scopeid||
       local[SCOPE_KEY]!==scopeid||!Number.isInteger(binding.tabId))
      throw Error('LOC 網站授權頁不存在，請從 Extension 重新連線');
    const token=await new Promise(async(resolve,reject)=>{
      let timeout;
      const done=(error,value)=>{
        chrome.storage.onChanged.removeListener(onChange);
        clearTimeout(timeout);
        error?reject(error):resolve(value);
      };
      const onChange=(changes,area)=>{
        const next=changes[ACCESS_KEY]?.newValue;
        if(area==='session'&&next?.scopeid===scopeid&&
           Number(next.expires_at)>Date.now()+15000)done(null,next.access_token);
      };
      chrome.storage.onChanged.addListener(onChange);
      timeout=setTimeout(()=>done(Error('LOC 網站未完成短效憑證更新；請確認授權分頁仍開啟')),15000);
      try{
        await chrome.scripting.executeScript({
          target:{tabId:binding.tabId},world:'MAIN',
          func:()=>window.dispatchEvent(new Event('locGalaxy.websiteRenew'))
        });
        const current=(await chrome.storage.session.get(ACCESS_KEY))[ACCESS_KEY];
        if(current?.scopeid===scopeid&&Number(current.expires_at)>Date.now()+30000)
          done(null,current.access_token);
      }catch(error){done(Error('LOC 網站授權頁無法喚醒，請保留該分頁'));}
    });
    return token;
  })();
  renewalFlight=flight;
  try{return await flight;}
  catch(error){renewalBlockedUntil=Date.now()+10000;throw error;}
  finally{if(renewalFlight===flight)renewalFlight=null;}
}

// The workbench never receives OAuth tokens. Only the trusted service worker
// sends approved, validated MCP calls with the verified Scope's credential.
async function verifiedAccess(scopeid){
  checkedScope(scopeid);
  const state=await authorizedStatus();
  if(!state.ready||state.scopeid!==scopeid){
    if(state.website_session_expired)
      throw Error('LOC 網站短效憑證暫不可用；請保留授權頁並按「重新確認網站登入」');
    if(state.temporary_unavailable)
      throw Error('LOC Authority 暫時無法驗證授權；目前授權資料已保留');
    throw Error('請先完成 LOC Galaxy 的 Scope OAuth 授權');
  }
  const {auth,access}=await readAll();
  if(access?.scopeid===scopeid&&access.access_token&&
     Number(access.expires_at)>Date.now()+30000)return access.access_token;
  if(auth?.mode==='website')return renewWebsiteAccess(scopeid);
  if(access?.scopeid===scopeid&&access.access_token&&
     Number(access.expires_at)>Date.now()+15000)return access.access_token;
  throw Error('LOC MCP Access Token 已過期，請重新驗證 OAuth');
}
async function galaxyRequest(message){
  const scopeid=checkedScope(message.scopeid);
  const action=String(message.action||'');
  if(!['search','read'].includes(action)||message.source!==undefined)
    throw Error('Galaxy Link 僅支援固定 MCP 來源');
  const token=await verifiedAccess(scopeid);
  if(action==='search'){
    const query=String(message.query||'').trim();
    if(query.length<2||query.length>100||/[\u0000-\u001f\u007f]/.test(query))
      throw Error('請輸入 2–100 字的搜尋詞');
    const key=scopeid;
    const last=linkSearchStarted.get(key)||0;
    if(Date.now()-last<30000)throw Error('Galaxy Link 搜尋有 QoS 限制，請稍後再查詢');
    linkSearchStarted.set(key,Date.now());
    return mcpTool(token,'galaxy_link',{action:'search',scopeid,query,limit:5});
  }
  if(!/^[A-Za-z0-9]{8}$/.test(String(message.uid||'')))
    throw Error('Galaxy UID 必須是八碼大小寫相符的英數字');
  const offset=Number(message.offset??0);
  if(!Number.isInteger(offset)||offset<0||offset>1000000)
    throw Error('文章讀取位置無效');
  return mcpTool(token,'galaxy_link',{
    action:'read',scopeid,uid:message.uid,offset,max_chars:20000
  });
}
async function recorderRequest(message){
  const scopeid=checkedScope(message.scopeid);
  const token=await verifiedAccess(scopeid);
  const input=validateConversation(message.conversation);
  // Server checkpoint and append are authoritative. No client-side cursor advances.
  const status=await mcpTool(token,'galaxy_link',{
    action:'check',scopeid,conversation_id:input.conversation_id,
    updated_at:input.updated_at
  });
  if(status.scopeid!==scopeid||status.conversation_id!==input.conversation_id)
    throw Error('Galaxy Recorder checkpoint 來源不一致');
  // New source message IDs may be older than the last conversation checkpoint.
  // In capture mode let the server's immutable batch dedup decide, not timestamp alone.
  if(status.needs_save===false&&!message.forceAppend)
    return {saved:false,unchanged:true,uid:status.uid||null};
  const uid=input.uid||status.uid||undefined;
  const result=await mcpTool(token,'galaxy_link',{
    action:'record',scopeid,...input,...(uid?{uid}:{})
  });
  if(result.scopeid&&result.scopeid!==scopeid)
    throw Error('Galaxy Recorder 回應 Scope 不符');
  return {saved:true,uid:result.uid||uid||null,result};
}

async function openWorkspace(message){
  const scopeid=checkedScope(message.scopeid);
  await verifiedAccess(scopeid);
  if(message.type==='locGalaxy.openWorkbench'){
    const page=chrome.runtime.getURL('workbench.html?scopeid='+encodeURIComponent(scopeid));
    await chrome.tabs.create({url:page,active:true});
    return {scopeid,opened:true};
  }
  const mode=String(message.mode||'');
  const url=scopeManagementUrl(scopeid,mode);
  await chrome.tabs.create({url,active:true});
  return {scopeid,mode,opened:true};
}

const capture=captureController({
  record:payload=>recorderRequest({...payload,forceAppend:true}),
  authorized:authorizedStatus
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name===capture.ALARM)void capture.sync().catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>{void capture.resume().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.clear(WEBSITE_RENEW_ALARM);});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.clear(WEBSITE_RENEW_ALARM);});

const MENU_ARCHIVE='loc-galaxy-archive-conversation';
function registerArchiveMenu(){
  chrome.contextMenus.removeAll(()=>{
    chrome.contextMenus.create({
      id:MENU_ARCHIVE,
      title:'匯入此 ChatGPT 對話至 LOC Galaxy',
      contexts:['page'],
      documentUrlPatterns:['https://chatgpt.com/c/*','https://chatgpt.com/g/*/c/*']
    });
  });
}
chrome.runtime.onInstalled.addListener(registerArchiveMenu);
chrome.runtime.onStartup.addListener(registerArchiveMenu);
chrome.contextMenus.onClicked.addListener((info,tab)=>{
  if(info.menuItemId!==MENU_ARCHIVE)return;
  // Permission prompt is initiated by the user's context-menu gesture.
  void (async()=>{
    const granted=await chrome.permissions.request({origins:['https://chatgpt.com/*']});
    if(!granted)throw Error('未取得 ChatGPT 網站讀取權限');
    if(!Number.isInteger(tab?.id))throw Error('找不到選取的對話分頁');
    const snapshot=await capture.archiveActive(tab.id);
    let result={completed:0};
    let failure='';
    if(snapshot.queued>0){
      try{result=await capture.sync();}
      catch(error){failure=String(error?.message||error);}
    }
    const state=await readAll();
    const description='已暫存 '+Number(snapshot.queued||0)+' 則；已確認寫入 '+
      Number(result.completed||0)+' 則'+(failure?'；待同步：'+failure:'')+
      (snapshot.partial?'；目前頁面歷史可能不完整':'');
    const url=chrome.runtime.getURL('workbench.html?scopeid='+
      encodeURIComponent(state.scopeid)+'&archive_status='+encodeURIComponent(description));
    await chrome.tabs.create({url,active:true});
  })().catch(async error=>{
    const state=await readAll().catch(()=>({scopeid:''}));
    if(!state.scopeid)return;
    const url=chrome.runtime.getURL('workbench.html?scopeid='+
      encodeURIComponent(state.scopeid)+'&archive_status='+
      encodeURIComponent('匯入未完成：'+String(error?.message||error).slice(0,170)));
    await chrome.tabs.create({url,active:true});
  });
});


async function handle(message,sender){
  await protectStorage();
  switch(message?.type){
    case 'locGalaxy.status':return authorizedStatus();
    case 'locGalaxy.openWorkbench':
    case 'locGalaxy.openWorkspace':return openWorkspace(message);
    case 'locGalaxy.galaxy':return galaxyRequest(message);
    case 'locGalaxy.record':return recorderRequest(message);
    case 'locGalaxy.captureObserved':return capture.accept(message,sender);
    case 'locGalaxy.captureEnable':return capture.enable();
    case 'locGalaxy.captureDisable':return capture.disable();
    case 'locGalaxy.captureStatus':return capture.status();
    case 'locGalaxy.archiveCurrent':{
      const snapshot=await capture.archiveActive();
      if(snapshot.queued>0){
        try{return {...snapshot,sync:await capture.sync()};}
        catch(error){return {...snapshot,syncError:String(error?.message||error)};}
      }
      return snapshot;
    }
    case 'locGalaxy.captureSync':return capture.sync();
    case 'locGalaxy.openLogin':{
      const scopeid=await selectScope(message.scopeid);
      await chrome.tabs.create({url:SCENIC_LOGIN,active:true});
      return {scopeid,opened:true};
    }
    case 'locGalaxy.authorize':{
      if(inProgress)throw Error('另一個網站授權正在進行');
      inProgress=true;
      try{
        const scopeid=await selectScope(message.scopeid);
        const nonce=randomUrlSafe(32);
        const tab=await chrome.tabs.create({url:'about:blank',active:true});
        const pending={scopeid,nonce,tabId:tab.id,created:Date.now()};
        await chrome.storage.session.set({[BRIDGE_KEY]:pending});
        const url=LOC_ORIGIN+'/extension/auth-bridge.html?scopeid='+
          encodeURIComponent(scopeid)+'&nonce='+encodeURIComponent(nonce);
        try{await chrome.tabs.update(tab.id,{url});}
        catch(error){
          await chrome.storage.session.remove(BRIDGE_KEY);
          throw error;
        }
        return {ready:false,scopeid,pending:true};
      }finally{inProgress=false;}
    }
    case 'locGalaxy.disconnect':{
      linkSearchStarted.clear();
      await capture.clearOnScopeChange();
      await clearCredentials();
      return {ready:false};
    }
    default:throw Error('不支援的 LOC Galaxy 操作');
  }
}
// Webpage grants are handled only by website-grant-fallback.mjs; no duplicate external listener.
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id)return false;
  void handle(message,sender).then(data=>sendResponse({ok:true,data}))
    .catch(error=>sendResponse({ok:false,error:String(error?.message||'LOC Galaxy 連線失敗').slice(0,180)}));
  return true;
});
