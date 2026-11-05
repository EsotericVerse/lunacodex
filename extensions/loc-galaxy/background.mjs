import {
  LOC_ORIGIN,interactiveAuthorization,refreshAuthorization,
  verifyScopeAuthorization,mcpTool
} from './oauth.mjs';
import {scopeManagementUrl} from './workspace-routes.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SCOPE_KEY='locGalaxy.scopeid';
const OAUTH_KEY='locGalaxy.oauth';
const ACCESS_KEY='locGalaxy.access';
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
  await Promise.all([
    chrome.storage.local.remove(OAUTH_KEY),
    chrome.storage.session.remove(ACCESS_KEY)
  ]);
}
async function selectScope(scopeid){
  const next=checkedScope(scopeid);
  const state=await readAll();
  if(state.scopeid!==next){
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
async function authorizedStatus(){
  const {scopeid,auth,access}=await readAll();
  if(!scopeid)return {ready:false,scopeid:'',subject:''};
  if(!auth||auth.scopeid!==scopeid)
    return {ready:false,scopeid,subject:''};
  try{
    if(access?.scopeid===scopeid&&
      Number(access.expires_at)>Date.now()+60_000&&
      Number(access.verified_until)>Date.now())
      return {ready:true,scopeid,subject:access.subject};
    let issued;
    if(access?.scopeid===scopeid&&Number(access.expires_at)>Date.now()+60_000)
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

// The workbench never receives OAuth tokens. Only the trusted service worker
// sends approved, validated MCP calls with the verified Scope's credential.
async function verifiedAccess(scopeid){
  checkedScope(scopeid);
  const state=await authorizedStatus();
  if(!state.ready||state.scopeid!==scopeid)throw Error('請先完成 LOC Galaxy 的 Scope OAuth 授權');
  const access=(await readAll()).access;
  if(access?.scopeid!==scopeid||!access.access_token||
     Number(access.expires_at)<Date.now()+15000)
    throw Error('LOC MCP Access Token 已過期，請重新驗證 OAuth');
  return access.access_token;
}
async function galaxyRequest(message){
  const scopeid=checkedScope(message.scopeid);
  const action=String(message.action||'');
  const source=message.source??'mcp';
  if(!['search','read'].includes(action)||!['mcp','github'].includes(source))
    throw Error('不支援的 Galaxy Link 查詢');
  const token=await verifiedAccess(scopeid);
  if(action==='search'){
    const query=String(message.query||'').trim();
    if(query.length<2||query.length>100||/[\u0000-\u001f\u007f]/.test(query))
      throw Error('請輸入 2–100 字的搜尋詞');
    const key=scopeid+':'+source;
    const last=linkSearchStarted.get(key)||0;
    if(Date.now()-last<30000)throw Error('Galaxy Link 搜尋有 QoS 限制，請稍後再查詢');
    linkSearchStarted.set(key,Date.now());
    return mcpTool(token,'galaxy_link',{action:'search',scopeid,source,query,limit:5});
  }
  if(!/^[A-Za-z0-9]{8}$/.test(String(message.uid||'')))
    throw Error('Galaxy UID 必須是八碼大小寫相符的英數字');
  const offset=Number(message.offset??0);
  if(!Number.isInteger(offset)||offset<0||offset>1000000)
    throw Error('文章讀取位置無效');
  return mcpTool(token,'galaxy_link',{
    action:'read',scopeid,source,uid:message.uid,offset,max_chars:20000
  });
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

async function handle(message){
  await protectStorage();
  switch(message?.type){
    case 'locGalaxy.status':return authorizedStatus();
    case 'locGalaxy.openWorkbench':
    case 'locGalaxy.openWorkspace':return openWorkspace(message);
    case 'locGalaxy.galaxy':return galaxyRequest(message);
    case 'locGalaxy.openLogin':{
      const scopeid=await selectScope(message.scopeid);
      await chrome.tabs.create({url:SCENIC_LOGIN,active:true});
      return {scopeid,opened:true};
    }
    case 'locGalaxy.authorize':{
      if(inProgress)throw Error('另一個 LOC OAuth 驗證正在進行');
      inProgress=true;
      try{
        const scopeid=await selectScope(message.scopeid);
        const issued=await interactiveAuthorization();
        const checked=await verifyScopeAuthorization(issued.access_token,scopeid);
        await commitAuthorization(scopeid,issued,checked.subject);
        return {ready:true,scopeid,subject:checked.subject};
      }finally{inProgress=false;}
    }
    case 'locGalaxy.disconnect':{
      linkSearchStarted.clear();
      await clearCredentials();
      return {ready:false};
    }
    default:throw Error('不支援的 LOC Galaxy 操作');
  }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id)return false;
  void handle(message).then(data=>sendResponse({ok:true,data}))
    .catch(error=>sendResponse({ok:false,error:String(error?.message||'LOC Galaxy 連線失敗').slice(0,180)}));
  return true;
});
