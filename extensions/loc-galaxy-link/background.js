// One LOC galaxy-link extension: one LOC Auth, one queue, multiple capture modes.
const DB_NAME='loc-channel1-queue';
const STORE='pending',ACK_STORE='acknowledged';
const MAX_BATCH=50,MAX_BYTES=600000,AUTO_CAPTURE_COUNT=10;
const CONFIG_URL='https://loc.lo3rwang.cc/extension/oauth/config.json';
const AUTH_KEYS=['locOAuth','locConfig'];
const MENU_PAGE='loc-page',MENU_SELECTION='loc-selection',MENU_AREA='loc-area',MENU_RECORD='loc-record',MENU_PAUSE='loc-pause',MENU_RESUME='loc-resume',MENU_STOP='loc-stop',MENU_ROOT='loc-galaxy-link';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const encoder=new TextEncoder();
const sizeOf=x=>encoder.encode(JSON.stringify(x)).length;
let inFlight=null;
function openDb(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,2);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
   if(!db.objectStoreNames.contains(ACK_STORE))db.createObjectStore(ACK_STORE,{keyPath:'id'});
  };
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
}
async function allEvents(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly');
  const req=tx.objectStore(STORE).getAll();
  req.onsuccess=()=>resolve(req.result||[]);
  req.onerror=()=>reject(req.error);
  tx.oncomplete=()=>db.close();
  tx.onerror=()=>reject(tx.error);
 });
}
async function putEvents(events){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,ACK_STORE],'readwrite');
  const queue=tx.objectStore(STORE),ack=tx.objectStore(ACK_STORE);
  let count=0;
  // Preserve immutable original captured_at when a pending record is
  // captured again. A changed captured_at with the same event UUID would
  // otherwise cause the server append fingerprint to reject safe retries.
  for(const row of events){
   const old=queue.get(row.id);
   old.onsuccess=()=>{
    if(old.result)return;
    const prior=ack.get(row.id);
    prior.onsuccess=()=>{if(!prior.result){queue.add(row);count++;}};
   };
  }
  tx.oncomplete=()=>{db.close();resolve(count);};
  tx.onerror=()=>{db.close();reject(tx.error);};
  tx.onabort=()=>{db.close();reject(tx.error);};
 });
}
async function removeEvents(records){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,ACK_STORE],'readwrite');
  const queue=tx.objectStore(STORE),ack=tx.objectStore(ACK_STORE);
  for(const row of records){
   // Durable receipts prevent repeated captures appending the same text
   // again after the Queue entry has been successfully acknowledged.
   ack.put({id:row.id,received_at:Date.now()});
   queue.delete(row.id);
  }
  tx.oncomplete=()=>{db.close();resolve();};
  tx.onerror=()=>{db.close();reject(tx.error);};
  tx.onabort=()=>{db.close();reject(tx.error);};
 });
}
function normalizedUrl(value){
 const u=new URL(value);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('只支援 HTTP(S) 來源');
 u.hash='';
 for(const key of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^igshid$/i.test(key))u.searchParams.delete(key);
 return u.href;
}
// A Threads permalink may use threads.net while the active page uses
// threads.com (and Instagram has www/mobile aliases). Only exact platform
// hostnames may cross origins; arbitrary redirects remain forbidden.
function captureSourceMatches(pageUrl,sourceUrl){
 const page=new URL(pageUrl),source=new URL(sourceUrl);
 if(!['http:','https:'].includes(page.protocol)||!['http:','https:'].includes(source.protocol))return false;
 if(page.origin===source.origin)return true;
 if(page.protocol!=='https:'||source.protocol!=='https:')return false;
 const THREADS=new Set(['threads.net','www.threads.net','threads.com','www.threads.com']);
 const INSTAGRAM=new Set(['instagram.com','www.instagram.com','m.instagram.com']);
 return (THREADS.has(page.hostname)&&THREADS.has(source.hostname))||
   (INSTAGRAM.has(page.hostname)&&INSTAGRAM.has(source.hostname));
}
async function stableUuid(input){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(input)));
 const hex=[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
 // Version 5/variant RFC 4122 fingerprint UUID; retries keep the same event ID.
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-'+
  ((parseInt(hex[16],16)&3)|8).toString(16)+hex.slice(17,20)+'-'+hex.slice(20,32);
}
async function toEvents(items,scopeid='lo3rwang'){
 if(!SCOPE.test(scopeid))throw Error('不支援的銀河 Scope');
 if(!Array.isArray(items)||!items.length||items.length>100)throw Error('擷取項目數量超出限制');
 const rows=[];
 for(const item of items){
  if(!item||typeof item.content!=='string'||!item.content.trim())continue;
  const url=normalizedUrl(item.url||item.source_key);
  const source_key=normalizedUrl(item.source_key||item.url);
  if(url!==source_key)continue;
  const title=String(item.title||'未命名網頁').slice(0,350);
  const content=item.content.trim();
  // Use per-item capture groups, not one group for unrelated posts.
  const group_id=await stableUuid(scopeid+'\u0000'+source_key+'\u0000'+(item.key||'')+'\u0000'+content);
  const partSize=85000,part_count=Math.ceil(content.length/partSize);
  if(part_count>10000)throw Error('文章過長');
  for(let index=0;index<part_count;index++){
   const part=content.slice(index*partSize,(index+1)*partSize);
   const id=await stableUuid(scopeid+'\u0000'+source_key+'\u0000'+(item.key||'')+'\u0000'+part+'\u0000'+index);
   rows.push({id,group_id,scopeid,source_key,url,title,kind:'capture',write_mode:'append',
    part_index:index,part_count,captured_at:new Date().toISOString(),content:part});
  }
 }
 return rows;
}
function captureTotals(rows){return {pending:rows.length,pendingCaptures:new Set(rows.map(r=>r.group_id||r.id)).size};}
async function updateQueueBadge(rows=null){
 const totals=captureTotals(rows||await allEvents());
 const count=totals.pendingCaptures;
 await chrome.action.setBadgeText({text:count?(count>99?'99+':String(count)):''});
 await chrome.action.setTitle?.({title:count?'LOC 彩虹橋：待送 '+count+' 次擷取':'LOC 彩虹橋：Queue 0 次待送'});
 return totals;
}
async function clearLegacyTabBadges(){
 // Older versions wrote '!' / 'OK' to individual tab badges. Those per-tab
 // overrides survive until explicitly cleared and hide the real Queue count.
 const tabs=await chrome.tabs.query({});
 await Promise.all(tabs.filter(t=>Number.isInteger(t.id)).map(t=>
  chrome.action.setBadgeText({text:'',tabId:t.id}).catch(()=>{})));
}
async function noteAction(name,ok,message,tabId=null){
 const item={name:String(name||'擷取'),ok:ok===true,
  message:String(message||'未提供原因').slice(0,600),at:new Date().toISOString()};
 await chrome.storage.local.set({locLastAction:item}).catch(()=>{});
 if(tabId)await chrome.tabs.sendMessage(tabId,{type:'page.feedback',ok:item.ok,
  message:item.name+'：'+item.message}).catch(()=>{});
 return item;
}
function ready(rows){
 return rows.length && (new Set(rows.map(x=>x.group_id)).size>=AUTO_CAPTURE_COUNT ||
  sizeOf(rows)>=MAX_BYTES);
}
async function queueCount(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly');
  const req=tx.objectStore(STORE).count();
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
  tx.oncomplete=()=>db.close();
 });
}
async function acceptItems(items){
 if(!Array.isArray(items)||items.length>2000)
  throw Error('擷取數量超出上限（2000 則），請分段錄製；原有 Queue 保留');
 const {locTargetScope='lo3rwang',locImportPaused=false}=
  await chrome.storage.local.get(['locTargetScope','locImportPaused']);
 const events=[];
 for(let i=0;i<items.length;i+=100)
  events.push(...await toEvents(items.slice(i,i+100),locTargetScope));
 if(!events.length)return {message:'目前頁面沒有符合擷取條件的可見內容',queued:(await allEvents()).length,empty:true};
 const inserted=await putEvents(events);
 await updateQueueBadge().catch(error=>console.warn('[LOC Queue badge]',String(error)));
 if(locImportPaused)return {message:'已保留 Queue：'+inserted+' 筆',queued:await queueCount()};
 const all=await allEvents();
 if(ready(all))void flush(false).catch(async error=>{
  console.warn('[LOC galaxy-link automatic import]',String(error));
  await noteAction('自動傳送',false,error?.message||String(error));
 });
 return {message:'新加入 Queue：'+inserted+' 筆（重複擷取已略過）',queued:all.length};
}

function packet(rows){
 const out=[];let current=[];
 for(const row of rows){
  const next=[...current,row];
  // Add enough headroom for JSON batch envelope.
  if(current.length&&(next.length>MAX_BATCH||sizeOf({id:'00000000-0000-4000-8000-000000000000',write_mode:'append',records:next})>590000)){
   out.push(current);current=[row];
  }else current=next;
 }
 if(current.length)out.push(current);
 return out;
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
    api.origin!=='https://mcp.lo3rwang.cc'||api.pathname!=='/api/loc-native'||
    cfg.resource!=='https://mcp.lo3rwang.cc'||!cfg.client_id||typeof cfg.client_id!=='string'||
    issuer.origin!=='https://auth.lo3rwang.cc'||issuer.pathname!=='/api/auth')
   throw oauthError('LOC 自有認證尚未啟用，不會使用其他平台登入');
 const metaUrl=new URL('/.well-known/oauth-authorization-server',issuer);
 const metaReply=await fetch(metaUrl,{cache:'no-store',redirect:'error'});
 if(!metaReply.ok)throw oauthError('找不到 LOC OAuth 伺服器');
 const meta=await metaReply.json();
 if(meta.issuer!==(issuer.href.endsWith('/')?issuer.href.slice(0,-1):issuer.href)||
    !meta.authorization_endpoint||!meta.token_endpoint)
   throw oauthError('授權伺服器資訊不完整');
 for(const endpoint of [meta.authorization_endpoint,meta.token_endpoint]){
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.origin!==issuer.origin)
   throw oauthError('OAuth 端點必須使用 LOC Auth HTTPS');
 }
 const config={supports_scope_routing:true,issuer:meta.issuer,client_id:cfg.client_id,import_url:api.href,
   resource:cfg.resource||api.href,
  authorization_endpoint:meta.authorization_endpoint,token_endpoint:meta.token_endpoint,
  revocation_endpoint:meta.revocation_endpoint||'',
  scope:cfg.scope||'loc:import'};
 await chrome.storage.local.set({locConfig:config});
 return config;
}
async function exchange(config,body){
 const res=await fetch(config.token_endpoint,{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({...body,client_id:config.client_id,resource:config.resource}).toString(),
  redirect:'error',cache:'no-store'});
 if(!res.ok)throw oauthError('Token 交換失敗（HTTP '+res.status+'）');
 const json=await res.json();
 if(!json.access_token||json.token_type?.toLowerCase()!=='bearer')
  throw oauthError('伺服器未回傳 Bearer Token');
 return json;
}
// Public PKCE client: use the stable HTTPS Client ID Metadata Document
// already published by LOC Web, rather than writing a new OAuth client
// registration on every install or reauthorization.
function registeredClient(config,redirect){
 const clientId='https://loc.lo3rwang.cc/extension/oauth/client.json';
 const callback='https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc';
 if(config.client_id!==clientId||redirect!==callback)
  throw oauthError('LOC 彩虹橋 OAuth Client Metadata 與 Chrome 回呼不一致');
 return clientId;
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
   if(endpoint.origin===new URL(cfg.issuer).origin&&endpoint.pathname==='/api/auth/oauth2/revoke'){
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
 cfg.client_id=registeredClient(cfg,redirect);
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
 await chrome.storage.local.remove(['locImportPaused','locQueuePaused']);
 return {connected:true};
}
let refreshFlight=null;
async function activeToken(forceRefresh=false){
 const {locOAuth:tokens,locConfig:cfg}=await chrome.storage.local.get(AUTH_KEYS);
 if(!tokens||!cfg)throw oauthError('請先在設定頁連接 LOC');
 if(!forceRefresh&&tokens.access_token&&tokens.expires_at>Date.now())return tokens.access_token;
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

function contractError(message){return Object.assign(new Error(message),{code:'LOC_IMPORT_CONTRACT'})}
function validateArticleReceipts(receipts,records){
 if(!Array.isArray(receipts))throw contractError('LOC 未回傳 UID 回執，Queue 保留');
 const received=new Map();
 for(const r of receipts)if(typeof r?.source_key==='string'&&/^[A-Za-z0-9]{8}$/.test(String(r.uid||'')))received.set(r.source_key,r.uid);
 for(const key of new Set(records.map(r=>r.source_key)))if(!received.has(key))throw contractError('未確認文章 UID：'+key);
}
async function sendViaAuth(scopeid,batch,token,config){
 if(!SCOPE.test(scopeid))throw Error('Invalid Scope');
 if(scopeid!=='lo3rwang'&&config.supports_scope_routing!==true)throw contractError('多 Scope 認證尚未啟用；Queue 保留，禁止錯誤寫入');
 const endpoint=new URL(config.import_url||'');
 if(endpoint.origin!=='https://mcp.lo3rwang.cc'||endpoint.pathname!=='/api/loc-native')throw contractError('LOC MCP 資料寫入位址錯誤');
 // The Scope is validated by LOC data authorization, not the Auth server.
 const reply=await fetch(endpoint.href,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({kind:'short-import',scopeid,batch}),redirect:'error',cache:'no-store'});
 if(!reply.ok){
   let detail='';
   const mime=String(reply.headers?.get?.('content-type')||'').toLowerCase();
   if(mime.includes('json')||mime.includes('text/plain')){
    try{
     const raw=(await reply.text()).slice(0,2000);
     const body=mime.includes('json')?JSON.parse(raw):null;
     const value=body?(body?.error?.message||body?.error||body?.message||body?.code):raw;
     const safe=typeof value==='string'?value:'';
     // Never expose tokens, database URLs, credential strings or HTML.
     detail=safe.replace(/(?:https?|postgres(?:ql)?|mysql|mssql|sqlserver):\/\/\S+/gi,'[URL]')
      .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+/gi,'Bearer [redacted]')
      .replace(/\b(?:password|secret|token|authorization)\s*[:=]\s*\S+/gi,'[redacted]')
      .replace(/<[^>]*>/g,' ').replace(/[\r\n\t]+/g,' ')
      .replace(/\s{2,}/g,' ').trim().slice(0,180);
    }catch{}
   }
   const e=Error('LOC 匯入失敗：HTTP '+reply.status+
    (detail?' — '+detail:'（後端未提供可讀取的錯誤說明）'));
   e.httpStatus=reply.status;
   e.retryAfter=reply.headers?.get?.('retry-after')||'';
   throw e;
  }
 const receipt=await reply.json().catch(()=>{throw contractError('LOC 回執不可解析')});
 if(receipt?.accepted!==true||receipt.id!==batch.id)throw contractError('LOC 未確認批次 ID');
 validateArticleReceipts(receipt.articles,batch.records);
 return receipt;
}
async function flush(force=false){
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const rows=(await allEvents()).sort((a,b)=>String(a.captured_at||'').localeCompare(String(b.captured_at||'')));
  if(!rows.length)return {message:'Queue 已清空',sent:0};
  if(!force&&!ready(rows))return {message:'未達批次門檻',sent:0};
  const settings=await chrome.storage.local.get(['locImportPaused','locQueueRetryAfter','locQueueRetryType','locQueueFailures','locConfig']);
  if(!force&&settings.locImportPaused)return {message:'已暫停自動傳送',sent:0};
  if(Number(settings.locQueueRetryAfter||0)>Date.now()&&
     (!force||settings.locQueueRetryType==='rate'))
    return {message:settings.locQueueRetryType==='rate'?'流量管制等待中':
     '後端故障暫緩自動重試（手動送出仍可執行）',sent:0};
  let token;
  try{token=await activeToken()}catch(e){await chrome.storage.local.set({locImportPaused:true});throw e}
  if(!settings.locConfig?.import_url){await chrome.storage.local.set({locImportPaused:true});throw Error('LOC 匯入設定不存在')}
  let count=0;
  try{
   for(const scopeid of [...new Set(rows.map(r=>r.scopeid||'lo3rwang'))]){
    for(const group of packet(rows.filter(r=>(r.scopeid||'lo3rwang')===scopeid))){
     const batch={id:await stableUuid(group.map(r=>r.id).sort().join('|')),write_mode:'append',records:group.map(({scopeid:localScope,...record})=>({...record,source_key:record.source_key||normalizedUrl(record.url),write_mode:'append',kind:record.kind||'capture'}))};
     try{await sendViaAuth(scopeid,batch,token,settings.locConfig)}
     catch(error){
       if(error.httpStatus!==401)throw error;
       // A token can be revoked before its local expiry. Refresh once, then
       // require the same server-side UID receipt before acknowledging Queue.
       try{token=await activeToken(true)}
       catch{
         const expired=oauthError('授權已失效，請重新連接 LOC');
         expired.httpStatus=401;
         throw expired;
       }
       await sendViaAuth(scopeid,batch,token,settings.locConfig);
     }
     await removeEvents(group); // Clear only after complete server-side UID receipts.
     await updateQueueBadge().catch(error=>console.warn('[LOC Queue badge]',String(error)));
     count+=group.length;
    }
   }
   await chrome.storage.local.remove(['locImportPaused','locQueueRetryAfter','locQueueRetryType','locQueueFailures']);
   return {message:'LOC 已確認寫入 '+count+' 筆',sent:count};
  }catch(e){
   const s=Number(e.httpStatus||0);
   if(s===429){
     const v=String(e.retryAfter||'');
     const ms=/^\d+$/.test(v)?Number(v)*1000:(Date.parse(v)||0)-Date.now();
     await chrome.storage.local.set({locQueueRetryType:'rate',
       locQueueRetryAfter:Date.now()+(Number.isFinite(ms)&&ms>0?Math.min(ms,3600000):900000)});
    }else if(s>=500||(s===0&&e.code!=='LOC_IMPORT_CONTRACT')){
     const failures=Math.min(8,Math.max(0,Number(settings.locQueueFailures||0))+1);
     const delay=Math.min(3600000,60000*2**Math.min(failures,6));
     await chrome.storage.local.set({locQueueFailures:failures,
       locQueueRetryType:'server',locQueueRetryAfter:Date.now()+delay});
    }else if(e.code==='LOC_IMPORT_CONTRACT'||[400,401,403,404,409,410,413,415,422].includes(s))
     await chrome.storage.local.set({locImportPaused:true});
   throw e;
  }
 })().finally(()=>{inFlight=null});return inFlight;
}

async function inject(tabId){
 await chrome.scripting.executeScript({target:{tabId},files:['vendor/Readability.js','content.js']});
}
async function currentTab(){
 const tabs=await chrome.tabs.query({active:true,currentWindow:true});
 const tab=tabs[0];
 if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('請在一般網頁上使用');
 return tab;
}
async function capture(tab,selection='',includeAssistant=false){
 await inject(tab.id);
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.capture',selection,includeAssistant});
 if(!Array.isArray(reply?.items))throw Error('頁面沒有回傳內容');
 if(!reply.items.length)throw Error('未找到可擷取的內容：目前頁面可能尚未載入對話，或網站 DOM 格式已變更');
 return acceptItems(reply.items);
}
async function recordedTab(){
 const {locRecorderTabId}=await chrome.storage.local.get('locRecorderTabId');
 if(Number.isInteger(locRecorderTabId)&&locRecorderTabId>0)
  return {id:locRecorderTabId};
 return currentTab();
}
async function selectOrRecord(type,includeAssistant=false,providedTab=null){
 const tab=providedTab||await currentTab();
 // One active recorder. Stop the prior tab before moving the recorder.
 const prior=(await chrome.storage.local.get('locRecorderTabId')).locRecorderTabId;
 if(type==='page.record'&&Number.isInteger(prior)&&prior!==tab.id)
  await chrome.tabs.sendMessage(prior,{type:'page.stop'}).catch(()=>{});
 await inject(tab.id);
 const response=await chrome.tabs.sendMessage(tab.id,{type,includeAssistant});
 if(response?.ok!==true)throw Error('頁面沒有啟動選取／錄製工具');
 if(type==='page.record')await chrome.storage.local.set({locRecorderTabId:tab.id});
 return {message:type==='page.record'?'請點選錄製區域，開始追蹤動態貼文':'請點選要擷取的區域'};
}
async function controlRecording(type){
 const tab=await recordedTab();
 const reply=await chrome.tabs.sendMessage(tab.id,{type}).catch(()=>null);
 if(!reply?.ok)throw Error('目前頁面沒有可操作的錄製');
 return {message:type==='page.pause'?'已暫停錄製':type==='page.resume'?'已繼續錄製':'已停止錄製'};
}
async function stopRecording(){
 const tab=await recordedTab();
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.stop'}).catch(()=>null);
 await chrome.storage.local.remove('locRecorderTabId');
 if(reply?.error)throw Error('最後一次錄製入列失敗：'+reply.error);
 return {message:reply?.ok?'已停止錄製，最後內容已確認入列':'目前頁面沒有正在進行的錄製'};
}

// Context-menu options must reflect the actual active recording state.
const RECORD_MENU_IDS=[MENU_PAGE,MENU_SELECTION,MENU_AREA,MENU_RECORD,MENU_PAUSE,MENU_RESUME,MENU_STOP];
function menuVisibility(mode='idle'){
 const active=['record','paused','pick-record'].includes(mode);
 return {
  [MENU_PAGE]:!active,[MENU_SELECTION]:!active,[MENU_AREA]:!active,
  [MENU_RECORD]:!active,[MENU_PAUSE]:mode==='record',
  [MENU_RESUME]:mode==='paused',[MENU_STOP]:active
 };
}
async function syncMenus(mode='idle'){
 const visibility=menuVisibility(mode);
 await Promise.all(RECORD_MENU_IDS.map(id=>
  chrome.contextMenus.update(id,{visible:visibility[id]})));
 chrome.contextMenus.refresh?.();
}
async function shownMode(tab){
 if(!tab?.id)return 'idle';
 const {locRecorderTabId}=await chrome.storage.local.get('locRecorderTabId');
 if(locRecorderTabId!==tab.id)return 'idle';
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.status'}).catch(()=>null);
 const mode=String(reply?.mode||'idle');
 if(!['record','paused','pick-record'].includes(mode)){
  await chrome.storage.local.remove('locRecorderTabId');
  return 'idle';
 }
 return mode;
}
function installMenu(){
 chrome.contextMenus.removeAll().then(async()=>{
  chrome.contextMenus.create({id:MENU_ROOT,title:'LOC 彩虹橋｜galaxy-link',contexts:['page','selection']});
  for(const [id,title,contexts] of [
   [MENU_PAGE,'擷取整頁／可見對話',['page','selection']],
   [MENU_SELECTION,'擷取選取文字',['selection']],
   [MENU_AREA,'選取頁面區域',['page','selection']],
   [MENU_RECORD,'開始動態錄製',['page','selection']],
   [MENU_PAUSE,'暫停錄製',['page','selection']],
   [MENU_RESUME,'繼續錄製',['page','selection']],
   [MENU_STOP,'停止錄製',['page','selection']]
  ])chrome.contextMenus.create({id,parentId:MENU_ROOT,title,contexts,
    visible:menuVisibility()[id]});
 }).catch(e=>console.warn('[LOC galaxy-link menu]',String(e)));
}
chrome.runtime.onInstalled.addListener(async()=>{
 installMenu();
 await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
 await chrome.alarms.create('loc-galaxy-link-retry',{periodInMinutes:5});
 await clearLegacyTabBadges().catch(()=>{});
 await updateQueueBadge().catch(e=>console.warn('[LOC Queue badge]',String(e)));
});
chrome.runtime.onStartup?.addListener(()=>{
 installMenu();
 void updateQueueBadge().catch(e=>console.warn('[LOC Queue badge]',String(e)));
});
chrome.contextMenus.onShown?.addListener((_info,tab)=>{
 void shownMode(tab).then(syncMenus).catch(e=>console.warn('[LOC menu status]',String(e)));
});
// The toolbar icon opens the native extension settings, never a capture Popup.
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.contextMenus.onClicked.addListener((info,tab)=>{
 if(!tab?.id)return;
 const action=info.menuItemId;
 const label=({
  [MENU_PAGE]:'擷取整頁', [MENU_SELECTION]:'擷取選取文字',
  [MENU_AREA]:'選取區域', [MENU_RECORD]:'開始錄製',
  [MENU_PAUSE]:'暫停錄製',[MENU_RESUME]:'繼續錄製',[MENU_STOP]:'停止錄製'
 })[action]||'擷取';
 void (async()=>{
  const {locIncludeAssistant}=await chrome.storage.local.get('locIncludeAssistant');
  const ai=locIncludeAssistant===true;
  let result;
  switch(action){
   case MENU_PAGE:result=await capture(tab,'',ai);break;
   case MENU_SELECTION:result=await capture(tab,info.selectionText||'',ai);break;
   case MENU_AREA:result=await selectOrRecord('page.select',ai,tab);break;
   case MENU_RECORD:result=await selectOrRecord('page.record',ai,tab);break;
   case MENU_PAUSE:result=await controlRecording('page.pause');break;
   case MENU_RESUME:result=await controlRecording('page.resume');break;
   case MENU_STOP:result=await stopRecording();break;
   default:return;
  }
  if(action===MENU_RECORD)await syncMenus('pick-record');
  if(action===MENU_PAUSE)await syncMenus('paused');
  if(action===MENU_RESUME)await syncMenus('record');
  if(action===MENU_STOP)await syncMenus('idle');
  await noteAction(label,!result?.empty,result?.message||'操作已完成',tab.id);
  await updateQueueBadge().catch(()=>{});
 })().catch(async e=>{
  console.warn('[LOC galaxy-link '+label+']',e);
  await noteAction(label,false,e?.message||String(e),tab.id);
  await updateQueueBadge().catch(()=>{});
 });
});
chrome.alarms.onAlarm.addListener(e=>{
 if(e.name==='loc-galaxy-link-retry')void flush(false).catch(async err=>{
   console.warn('[LOC galaxy-link Queue]',String(err));
   await noteAction('自動重試',false,err?.message||String(err));
  });
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 (async()=>{
  switch(message?.action){
   case 'loc-connect':return connectLoc();
   case 'loc-disconnect':return disconnectLoc();
   case 'loc-flush':{
    try{const result=await flush(true);await updateQueueBadge();await noteAction('手動傳送',true,result.message);return result;}
    catch(e){await noteAction('手動傳送',false,e?.message||String(e));throw e;}
   }
   case 'loc-status':{
    const [session,queue]=await Promise.all([
     chrome.storage.local.get([...AUTH_KEYS,'locImportPaused','locLastAction','locQueueRetryAfter','locQueueRetryType','locQueueFailures']),allEvents()]);
    return {connected:Boolean(session.locOAuth?.refresh_token||session.locOAuth?.expires_at>Date.now()),
     configured:Boolean(session.locConfig),paused:session.locImportPaused===true,
     ...captureTotals(queue),lastAction:session.locLastAction||null,
     nextRetryAt:Number(session.locQueueRetryAfter||0),
     retryReason:session.locQueueRetryType||'',
     consecutiveFailures:Number(session.locQueueFailures||0)};
   }
  }
  switch(message?.type){
   case 'capture.report':
    if(sender.id!==chrome.runtime.id||!sender.tab?.url)throw Error('Invalid recorder sender');
    if(typeof message.message!=='string'||message.message.length>350)
     throw Error('Invalid recorder status');
    await noteAction('動態錄製',message.ok===true,message.message,sender.tab.id);
    return {recorded:true};
   case 'items.captured':
    if(sender.id!==chrome.runtime.id||!sender.tab?.url)throw Error('Invalid capture sender');
    try{
     if(!Array.isArray(message.items)||!message.items.length||message.items.length>100)
      throw Error('Invalid capture items');
     if(message.items.some(item=>{
      try{return !captureSourceMatches(sender.tab.url,item?.url)||
       !captureSourceMatches(sender.tab.url,item?.source_key)}catch{return true}
     }))throw Error('Source origin mismatch');
     const result=await acceptItems(message.items);
     await noteAction('動態擷取',!result.empty,result.message,sender.tab.id);
     return result;
    }catch(error){
     await noteAction('動態擷取',false,error?.message||String(error),sender.tab.id);
     throw error;
    }
   case 'capture':return capture(await currentTab(),'',message.includeAssistant===true);
   case 'select':return selectOrRecord('page.select',message.includeAssistant===true);
   case 'record.start':return selectOrRecord('page.record',message.includeAssistant===true);
   case 'record.pause':return controlRecording('page.pause');
   case 'record.resume':return controlRecording('page.resume');
   case 'record.stop':return stopRecording();
   case 'queue.status':{const rows=await allEvents();const s=await chrome.storage.local.get('locImportPaused');return {count:rows.length,bytes:sizeOf(rows),paused:s.locImportPaused===true};}
   case 'queue.scope':{const scopeid=String(message.scopeid||'');if(!SCOPE.test(scopeid))throw Error('Invalid Scope');await chrome.storage.local.set({locTargetScope:scopeid});return {message:'目的銀河：'+scopeid};}
   case 'queue.flush':return flush(true);
   case 'loc.open':await chrome.runtime.openOptionsPage();return {message:'請選擇連接 LOC 完成授權'};
   default:throw Error('Unknown galaxy-link action');
  }
 })().then(respond).catch(e=>respond({error:String(e?.message||e)}));return true;
});
