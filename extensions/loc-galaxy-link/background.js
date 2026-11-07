const MENU='loc-galaxy-link-save';
const DB_NAME='loc-channel1-queue',STORE='pending';
const MAX_BATCH_BYTES=600000, MAX_TEXT_CHARS=140000;
const AUTO_BATCH_CAPTURES=10; // local captures, not individual article chunks
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
// A split capture must enter the one queue atomically: either all parts exist
// or no part is eligible for import.
async function enqueueMany(records){
 const db=await dbOpen();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error('Capture enqueue aborted'));
  try{for(const record of records)store.put(record);}
  catch(error){tx.abort();reject(error);}
 });}finally{db.close();}
}
const allPending=()=>dbOperation('readonly',store=>store.getAll());
// Remove an acknowledged batch in one IndexedDB transaction. Partial local
// deletion would change the retry batch ID after a crash and risk duplicates.
async function acknowledgeBatch(records){
 const db=await dbOpen();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error('Acknowledgement aborted'));
  try{for(const record of records)store.delete(record.id);}
  catch(error){tx.abort();reject(error);}
 });}finally{db.close();}
}
async function badge(ok,message){
 await chrome.action.setBadgeBackgroundColor({color:ok?'#177245':'#a13b3b'});
 await chrome.action.setBadgeText({text:ok?'OK':'!'});
 if(message)console.info('[LOC galaxy-link]',message);
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
function sourceKey(url){
 const parsed=new URL(url);
 if(!['https:','http:'].includes(parsed.protocol))throw Error('不支援的文章來源網址');
 // Do not strip the hash: many single-page sites use it as the article ID.
 return parsed.href;
}
function orderedPending(records){
 return records.sort((a,b)=>String(a.captured_at||'').localeCompare(String(b.captured_at||''))||
  String(a.group_id||a.id).localeCompare(String(b.group_id||b.id))||
  (a.part_index||0)-(b.part_index||0));
}
function queueReady(records){
 const captures=new Set(records.map(r=>r.group_id||r.id));
 if(captures.size>=AUTO_BATCH_CAPTURES)return true;
 // Full byte budget also triggers transmission even for a single large page.
 return new TextEncoder().encode(JSON.stringify(records)).length>=MAX_BATCH_BYTES;
}
async function enqueuePage(record){
 const content=record.content, group_id=crypto.randomUUID(),source_key=sourceKey(record.url);
 const parts=Math.ceil(content.length/MAX_TEXT_CHARS);
 const chunks=[];let offset=0;
 while(offset<content.length){
  let end=Math.min(offset+MAX_TEXT_CHARS,content.length);
  if(end<content.length&&end>offset&&/^[\uD800-\uDBFF]$/.test(content[end-1]))end--;
  chunks.push(content.slice(offset,end));offset=end;
 }
 const events=chunks.map((chunk,i)=>({...record,id:crypto.randomUUID(),group_id,
  source_key,write_mode:'append',kind:'capture',
  part_index:i,part_count:chunks.length,content:chunk}));
 await enqueueMany(events);
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
    api.origin!==issuer.origin||api.pathname!=='/v1/import/short'||
    cfg.resource!==api.href||!cfg.client_id||typeof cfg.client_id!=='string'||
    issuer.origin!=='https://auth.lo3rwang.cc')
   throw oauthError('LOC 自有認證尚未啟用，不會使用其他平台登入');
 const metaUrl=new URL('/.well-known/oauth-authorization-server',issuer);
 const metaReply=await fetch(metaUrl,{cache:'no-store',redirect:'error'});
 if(!metaReply.ok)throw oauthError('找不到 LOC OAuth 伺服器');
 const meta=await metaReply.json();
 if(meta.issuer!==(issuer.href.endsWith('/')?issuer.href.slice(0,-1):issuer.href)||
    !meta.authorization_endpoint||!meta.token_endpoint||!meta.registration_endpoint)
   throw oauthError('授權伺服器資訊不完整');
 for(const endpoint of [meta.authorization_endpoint,meta.token_endpoint,meta.registration_endpoint]){
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.origin!==issuer.origin)
   throw oauthError('OAuth 端點必須使用 LOC Auth HTTPS');
 }
 const config={issuer:meta.issuer,client_id:cfg.client_id,import_url:api.href,
   resource:cfg.resource||api.href,
  authorization_endpoint:meta.authorization_endpoint,token_endpoint:meta.token_endpoint,
  registration_endpoint:meta.registration_endpoint,
  revocation_endpoint:meta.revocation_endpoint||'',
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
async function registeredClient(config,redirect){
 const {locRegisteredOAuthClient:prior}=await chrome.storage.local.get('locRegisteredOAuthClient');
 if(prior?.issuer===config.issuer&&prior.redirect===redirect&&
  prior.expires_at>Date.now()+86400000&&/^loc-mcp-[A-Za-z0-9_-]{43}$/.test(prior.client_id))
  return prior.client_id;
 const reply=await fetch(config.registration_endpoint,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({client_name:'LOC 彩虹橋',
   redirect_uris:[redirect],response_types:['code'],
   grant_types:['authorization_code','refresh_token'],
   token_endpoint_auth_method:'none'}),
  cache:'no-store',redirect:'error'
 });
 if(!reply.ok)throw oauthError('無法註冊 Chrome OAuth Client（HTTP '+reply.status+'）');
 const saved=await reply.json();
 if(!/^loc-mcp-[A-Za-z0-9_-]{43}$/.test(String(saved.client_id||''))||
   !saved.redirect_uris?.includes(redirect))
  throw oauthError('LOC Auth 未確認 Chrome 回呼網址');
 const next={issuer:config.issuer,redirect,client_id:saved.client_id,
  expires_at:Number(saved.client_id_expires_at||0)*1000||Date.now()+86400000};
 await chrome.storage.local.set({locRegisteredOAuthClient:next});
 return next.client_id;
}
async function disconnectLoc(){
 // Keep all pending Queue data even if server-side revocation is unavailable.
 if(refreshFlight)await refreshFlight.catch(()=>{});
 const state=await chrome.storage.local.get(AUTH_KEYS);
 const token=state.locOAuth?.refresh_token,cfg=state.locConfig;
 let revoked=false;
 if(token&&cfg?.client_id&&cfg?.revocation_endpoint){
  try{
   const endpoint=new URL(cfg.revocation_endpoint);
   if(endpoint.origin===new URL(cfg.issuer).origin&&endpoint.pathname==='/oauth/revoke'){
    const reply=await fetch(endpoint.href,{method:'POST',redirect:'error',cache:'no-store',
     headers:{'content-type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({client_id:cfg.client_id,token,
      token_type_hint:'refresh_token'}).toString()});
    revoked=reply.ok;
   }
  }catch{}
 }
 await chrome.storage.local.remove(AUTH_KEYS);
 return {disconnected:true,serverRevoked:revoked,
  ...(token&&!revoked?{warning:'已清除本機授權；伺服器無法確認撤銷，請在連線恢復後重新登入。'}:{})};
}
async function connectLoc(){
 const cfg=await getConfig();
 const redirect=chrome.identity.getRedirectURL('loc');
 cfg.client_id=await registeredClient(cfg,redirect);
 await chrome.storage.local.set({locConfig:cfg});
 const verifier=encode64(crypto.getRandomValues(new Uint8Array(32)));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const state=crypto.randomUUID();
 const authorization=new URL(cfg.authorization_endpoint);
 for(const [key,val] of Object.entries({response_type:'code',client_id:cfg.client_id,
  redirect_uri:redirect,scope:cfg.scope,resource:cfg.resource,state,code_challenge:encode64(digest),
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
 await chrome.storage.local.remove('locQueuePaused');
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
  disconnectLoc().then(respond)
   .catch(e=>respond({error:e.message}));
  return true;
 }
 if(message?.action==='loc-status'){
  Promise.all([chrome.storage.local.get([...AUTH_KEYS,'locQueuePaused']),allPending()]).then(([s,pending])=>respond({
    connected:Boolean(s.locOAuth?.refresh_token||s.locOAuth?.expires_at>Date.now()),
    configured:Boolean(s.locConfig),paused:s.locQueuePaused===true,pending:pending.length,
    pendingCaptures:new Set(pending.map(r=>r.group_id||r.id)).size
  })).catch(e=>respond({error:e.message}));
  return true;
 }
 if(message?.action==='loc-flush'){
  flush(true).then(count=>respond({sent:count})).catch(e=>respond({error:e.message}));
  return true;
 }
});

function importContractError(message){
 return Object.assign(new Error(message),{code:'LOC_IMPORT_CONTRACT'});
}
function validateArticleReceipts(receipts,records){
 if(!Array.isArray(receipts))throw importContractError('LOC 尚未回傳來源文章 UID，Queue 保留');
 const entries=new Map();
 for(const item of receipts){
  if(typeof item?.source_key==='string'&&/^[0-9A-Za-z]{8}$/.test(String(item.uid||'')))
   entries.set(item.source_key,item.uid);
 }
 for(const key of new Set(records.map(r=>r.source_key)))
  if(!entries.has(key))throw importContractError('LOC 未確認文章 UID：'+key);
}
async function flush(force=false){
 if(processing)return processing;
 processing=(async()=>{
  const pending=orderedPending(await allPending());
  if(!pending.length)return 0;
  const state=await chrome.storage.local.get(['locQueueRetry','locQueueRetryAfter','locQueuePaused']);
  if(state.locQueuePaused&&!force)return 0;
  if(Number(state.locQueueRetryAfter||0)>Date.now())return 0;
  if(!force&&!state.locQueueRetry&&!queueReady(pending))return 0;
  // One OAuth lookup per ready flush, not per capture or individual article.
  let token;
  try{token=await activeToken();}
  catch(error){
   // Do not retry unavailable or invalid OAuth every five minutes.
   await chrome.storage.local.set({locQueuePaused:true});
   throw error;
  }
  const {locConfig:config}=await chrome.storage.local.get('locConfig');
  if(!config?.import_url){
   await chrome.storage.local.set({locQueuePaused:true});
   throw oauthError('未設定 LOC 短匯入 API');
  }
  let sent=0;
  try{
   const events=pending.map(r=>({...r,source_key:r.source_key||sourceKey(r.url),
    write_mode:'append',kind:r.kind||'capture'}));
   for(const records of batches(events)){
    // One request carries multiple independent article append events.
    // The backend must deduplicate each record.id even when batch membership
    // changes after a lost acknowledgement or another capture.
    const batch={id:await stableBatchId(records),write_mode:'append',records};
    const reply=await fetch(config.import_url,{
     method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
     body:JSON.stringify(batch)
    });
    if(!reply.ok){
     if([400,401,403,404,409,410,413,415,422].includes(reply.status))
      await chrome.storage.local.set({locQueuePaused:true});
     if(reply.status===429){
      const header=reply.headers?.get?.('retry-after');
      const value=String(header||'').trim();
      const ms=/^\d+$/.test(value)?Number(value)*1000:
       (Date.parse(value)||0)-Date.now();
      await chrome.storage.local.set({locQueueRetryAfter:Date.now()+
       (Number.isFinite(ms)&&ms>0?Math.min(ms,3600000):900000)});
     }
     throw Error('LOC 匯入失敗：HTTP '+reply.status);
    }
    let result;
    try{result=await reply.json();}
    catch{throw importContractError('LOC 匯入回執格式錯誤，Queue 保留');}
    if(!result?.accepted||result.id!==batch.id)throw importContractError('LOC 未確認匯入批次');
    validateArticleReceipts(result.articles,records);
    await acknowledgeBatch(records);
    sent+=records.length;
   }
   await chrome.storage.local.remove(['locQueueRetry','locQueueRetryAfter','locQueuePaused']);
  }catch(error){
   if(error.code==='LOC_IMPORT_CONTRACT'){
    // Server may have written already; never blindly retry an unconfirmed append.
    await chrome.storage.local.set({locQueuePaused:true});
   }else await chrome.storage.local.set({locQueueRetry:true});
   throw error;
  }
  return sent;
 })().finally(()=>{processing=null;});
 return processing;
}
chrome.runtime.onInstalled.addListener(async()=>{
 await chrome.contextMenus.removeAll();
 chrome.contextMenus.create({id:MENU,title:'LOC 彩虹橋：擷取並儲存此頁',contexts:['page']});
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
  const pending=await allPending();
  const ready=queueReady(pending);
  await badge(true,ready?'Queue 已達門檻，準備批次送出':'已累積 Queue：'+
   new Set(pending.map(r=>r.group_id||r.id)).size+'/'+AUTO_BATCH_CAPTURES+' 次擷取');
  if(ready&&!await chrome.alarms.get('loc-channel1-drain'))
   await chrome.alarms.create('loc-channel1-drain',{delayInMinutes:0.5});
 })().catch(async e=>{console.error('[LOC galaxy-link]',e);await badge(false,e.message);});
});
chrome.alarms.onAlarm.addListener(e=>{
 if(e.name==='loc-channel1-retry'||e.name==='loc-channel1-drain')
  flush().then(count=>{if(count)badge(true,'已送達 LOC：'+count+' 筆');}).catch(err=>{
   console.warn('[LOC galaxy-link Queue]',err.message);badge(false,err.message);
  });
});
