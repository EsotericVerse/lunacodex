const MENU='loc-channel1-save';
const DB_NAME='loc-channel1-queue',STORE='pending';
const MAX_BATCH_BYTES=600000, MAX_TEXT_CHARS=140000;
const CONFIG_URL='https://loc.lo3rwang.cc/extension/oauth/config.json';
const AUTH_KEYS=['locOAuth','locConfig'];
let processing=null;
function dbOpen(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
async function dbOperation(mode,run){
 const db=await dbOpen();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
  let value;
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error('Queue aborted'));
  try{const request=run(store);request.onsuccess=()=>{value=request.result;};request.onerror=()=>reject(request.error);}catch(e){tx.abort();reject(e);}
 });}finally{db.close();}
}
const enqueue=record=>dbOperation('readwrite',store=>store.put(record));
const allPending=()=>dbOperation('readonly',store=>store.getAll());
const acknowledge=id=>dbOperation('readwrite',store=>store.delete(id));
async function badge(ok,message){
 await chrome.action.setBadgeBackgroundColor({color:ok?'#177245':'#a13b3b'});
 await chrome.action.setBadgeText({text:ok?'OK':'!'});
 if(message)console.info('[LOC Channel 1]',message);
}
function parsePage(){
 const main=document.querySelector('main, [role="main"], article, [itemprop="articleBody"]')||document.body;
 const fallback=main===document.body;
 if(!main)return {error:'無法取得網頁內容'};
 const deny='script,style,noscript,nav,header,footer,aside,button,input,textarea,select,[role="navigation"],[role="menu"],[role="toolbar"],[aria-hidden="true"]';
 const walker=document.createTreeWalker(main,NodeFilter.SHOW_TEXT),parts=[];
 let node;
 while((node=walker.nextNode())){
  const parent=node.parentElement;
  if(!parent||parent.closest(deny)||parent.closest('[hidden],[inert]'))continue;
  const css=getComputedStyle(parent);
  if(css.display==='none'||css.visibility==='hidden')continue;
  const line=node.textContent.replace(/\s+/g,' ').trim();
  if(line)parts.push(line);
 }
 const content=parts.join('\n').trim();
 if(content.length<12)return {error:'網頁可解析內容過少，未儲存'};
 return {url:location.href,title:document.title,source:location.hostname,
  content,captured_at:new Date().toISOString(),
  extraction:fallback?'dom-body-fallback':'dom-main-content',
  completeness:'loaded-dom-only'};
}
async function capture(tabId){
 const result=await chrome.scripting.executeScript({target:{tabId},func:parsePage});
 const data=result?.[0]?.result;
 if(!data||data.error)throw Error(data?.error||'讀取頁面失敗');
 return data;
}
async function enqueuePage(record){
 const content=record.content, group_id=crypto.randomUUID();
 const parts=Math.ceil(content.length/MAX_TEXT_CHARS);
 const chunks=[];let offset=0;
 while(offset<content.length){
  let end=Math.min(offset+MAX_TEXT_CHARS,content.length);
  if(end<content.length&&end>offset&&/^[\uD800-\uDBFF]$/.test(content[end-1]))end--;
  chunks.push(content.slice(offset,end));offset=end;
 }
 for(let i=0;i<chunks.length;i++)await enqueue({...record,id:crypto.randomUUID(),group_id,
  part_index:i,part_count:chunks.length,content:chunks[i]});
 return chunks.length;
}
function batches(records){
 const encoder=new TextEncoder();const sets=[];let current=[],bytes=80;
 for(const record of records){
  const size=encoder.encode(JSON.stringify(record)).length+2;
  if(size>MAX_BATCH_BYTES-80)throw Error('單筆內容過大，無法打包');
  if(current.length&&(bytes+size>MAX_BATCH_BYTES||current.length>=50)){
   sets.push(current);current=[];bytes=80;
  }
  current.push(record);bytes+=size;
 }
 if(current.length)sets.push(current);
 return sets;
}
async function stableBatchId(records){
 const data=new TextEncoder().encode(records.map(r=>r.id).join(':'));
 const bits=new Uint8Array(await crypto.subtle.digest('SHA-256',data)).slice(0,16);
 bits[6]=(bits[6]&15)|64;bits[8]=(bits[8]&63)|128;
 const h=Array.from(bits,b=>b.toString(16).padStart(2,'0')).join('');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}

function encode64(bytes){
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function oauthError(message){return Error('LOC Auth：'+message);}
async function getConfig(){
 const res=await fetch(CONFIG_URL,{cache:'no-store',redirect:'error'});
 if(!res.ok)throw oauthError('尚未提供 Extension 認證設定');
 const cfg=await res.json();
 if(!cfg.issuer||!cfg.import_url||!cfg.client_id)
  throw oauthError('LOC 自有認證與短匯入 API 尚未啟用');
 const issuer=new URL(cfg.issuer);
 const api=new URL(cfg.import_url);
 if(issuer.protocol!=='https:'||api.protocol!=='https:'||
    !cfg.client_id||typeof cfg.client_id!=='string'||
    /clerk|supabase|github/i.test(issuer.hostname))
   throw oauthError('LOC 自有認證尚未啟用，不會使用其他平台登入');
 const metaUrl=new URL('/.well-known/oauth-authorization-server',issuer);
 const metaReply=await fetch(metaUrl,{cache:'no-store',redirect:'error'});
 if(!metaReply.ok)throw oauthError('找不到 LOC OAuth 伺服器');
 const meta=await metaReply.json();
 if(meta.issuer!==(issuer.href.endsWith('/')?issuer.href.slice(0,-1):issuer.href)||
    !meta.authorization_endpoint||!meta.token_endpoint)
   throw oauthError('授權伺服器資訊不完整');
 for(const endpoint of [meta.authorization_endpoint,meta.token_endpoint]){
  if(new URL(endpoint).protocol!=='https:')throw oauthError('OAuth 端點必須使用 HTTPS');
 }
 const config={issuer:meta.issuer,client_id:cfg.client_id,import_url:api.href,
  authorization_endpoint:meta.authorization_endpoint,token_endpoint:meta.token_endpoint,
  scope:cfg.scope||'loc:import'};
 await chrome.storage.local.set({locConfig:config});
 return config;
}
async function exchange(config,body){
 const res=await fetch(config.token_endpoint,{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({...body,client_id:config.client_id}).toString(),
  redirect:'error',cache:'no-store'});
 if(!res.ok)throw oauthError('Token 交換失敗（HTTP '+res.status+'）');
 const json=await res.json();
 if(!json.access_token||json.token_type?.toLowerCase()!=='bearer')
  throw oauthError('伺服器未回傳 Bearer Token');
 return json;
}
async function connectLoc(){
 const cfg=await getConfig();
 const verifier=encode64(crypto.getRandomValues(new Uint8Array(32)));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const state=crypto.randomUUID();
 const redirect=chrome.identity.getRedirectURL('loc');
 const authorization=new URL(cfg.authorization_endpoint);
 for(const [key,val] of Object.entries({response_type:'code',client_id:cfg.client_id,
  redirect_uri:redirect,scope:cfg.scope,state,code_challenge:encode64(digest),
  code_challenge_method:'S256'}))authorization.searchParams.set(key,val);
 const returned=await chrome.identity.launchWebAuthFlow({url:authorization.href,interactive:true});
 if(!returned||!returned.startsWith(redirect+'?'))throw oauthError('授權回呼無效');
 const result=new URL(returned),code=result.searchParams.get('code');
 if(result.searchParams.get('state')!==state||!code||result.searchParams.get('error'))
  throw oauthError('授權失敗或驗證碼不符');
 const tokens=await exchange(cfg,{grant_type:'authorization_code',code,redirect_uri:redirect,
  code_verifier:verifier});
 await chrome.storage.local.set({locOAuth:{
  access_token:tokens.access_token,refresh_token:tokens.refresh_token||null,
  expires_at:Date.now()+Math.max(0,Number(tokens.expires_in||300)-60)*1000}});
 return {connected:true};
}
let refreshFlight=null;
async function activeToken(){
 const {locOAuth:tokens,locConfig:cfg}=await chrome.storage.local.get(AUTH_KEYS);
 if(!tokens||!cfg)throw oauthError('請先在設定頁連接 LOC');
 if(tokens.access_token&&tokens.expires_at>Date.now())return tokens.access_token;
 if(!tokens.refresh_token)throw oauthError('授權已過期，請重新連接 LOC');
 if(refreshFlight)return refreshFlight;
 refreshFlight=(async()=>{
  const refreshed=await exchange(cfg,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});
  const next={access_token:refreshed.access_token,
   refresh_token:refreshed.refresh_token||tokens.refresh_token,
   expires_at:Date.now()+Math.max(0,Number(refreshed.expires_in||300)-60)*1000};
  await chrome.storage.local.set({locOAuth:next});
  return next.access_token;
 })().finally(()=>{refreshFlight=null;});
 return refreshFlight;
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(message?.action==='loc-connect'){
  connectLoc().then(respond).catch(error=>respond({connected:false,error:error.message}));
  return true;
 }
 if(message?.action==='loc-disconnect'){
  chrome.storage.local.remove(AUTH_KEYS).then(()=>respond({disconnected:true}))
   .catch(e=>respond({error:e.message}));
  return true;
 }
 if(message?.action==='loc-status'){
  chrome.storage.local.get(AUTH_KEYS).then(s=>respond({
    connected:Boolean(s.locOAuth?.refresh_token||s.locOAuth?.expires_at>Date.now()),
    configured:Boolean(s.locConfig)})).catch(e=>respond({error:e.message}));
  return true;
 }
});

async function flush(){
 if(processing)return processing;
 processing=(async()=>{
  const token=await activeToken();
  const {locConfig:config}=await chrome.storage.local.get('locConfig');
  if(!config?.import_url)throw oauthError('未設定 LOC 短匯入 API');
  const pending=(await allPending()).sort((a,b)=>a.captured_at.localeCompare(b.captured_at));
  for(const records of batches(pending)){
   const batch={id:await stableBatchId(records),records};
   const reply=await fetch(config.import_url,{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify(batch)
   });
   if(!reply.ok)throw Error('LOC 匯入失敗：HTTP '+reply.status);
   const result=await reply.json();
   if(!result.accepted||result.id!==batch.id)throw Error('LOC 未確認匯入批次');
   for(const item of records)await acknowledge(item.id);
  }
  return pending.length;
 })().finally(()=>{processing=null;});
 return processing;
}
chrome.runtime.onInstalled.addListener(async()=>{
 await chrome.contextMenus.removeAll();
 chrome.contextMenus.create({id:MENU,title:'LOC：解析並儲存此頁',contexts:['page']});
 await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
 await chrome.alarms.create('loc-channel1-retry',{periodInMinutes:5});
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.contextMenus.onClicked.addListener((info,tab)=>{
 if(info.menuItemId!==MENU||!tab?.id)return;
 (async()=>{
  const record=await capture(tab.id);
  const count=await enqueuePage(record);
  // Local queue is durable before any network request.
  await badge(true,'已加入本機佇列：'+count+' 筆');
  await chrome.alarms.create('loc-channel1-drain',{delayInMinutes:0.5});
 })().catch(async e=>{console.error('[LOC Channel 1]',e);await badge(false,e.message);});
});
chrome.alarms.onAlarm.addListener(e=>{
 if(e.name==='loc-channel1-retry'||e.name==='loc-channel1-drain')
  flush().then(count=>{if(count)badge(true,'已送達 LOC：'+count+' 筆');}).catch(err=>{
   console.warn('[LOC Queue retry]',err.message);badge(false,err.message);
  });
});
