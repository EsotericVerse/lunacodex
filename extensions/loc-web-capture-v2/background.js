// Independent Chrome MV3 capture pipeline; no Clerk, MCP or extension OAuth session.
const DB_NAME='loc-web-capture-v2';
const STORE='events';
const MAX_BATCH=50, MAX_BYTES=600000, AUTO_CAPTURE_COUNT=10;
const LOC_ORIGIN='https://loc.lo3rwang.cc';
const MENU_PAGE='loc-page', MENU_SELECTION='loc-selection';
const encoder=new TextEncoder();
const sizeOf=x=>encoder.encode(JSON.stringify(x)).length;
let inFlight=null;
function openDb(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
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
  const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);
  for(const row of events)store.put(row);
  tx.oncomplete=()=>{db.close();resolve(events.length);};
  tx.onerror=()=>{db.close();reject(tx.error);};
  tx.onabort=()=>{db.close();reject(tx.error);};
 });
}
async function removeEvents(records){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);
  for(const row of records)store.delete(row.id);
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
async function stableUuid(input){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(input)));
 const hex=[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
 // Version 5/variant RFC 4122 fingerprint UUID; retries keep the same event ID.
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-'+
  ((parseInt(hex[16],16)&3)|8).toString(16)+hex.slice(17,20)+'-'+hex.slice(20,32);
}
async function toEvents(items){
 const rows=[];
 for(const item of items.slice(0,100)){
  if(!item||typeof item.content!=='string'||!item.content.trim())continue;
  const url=normalizedUrl(item.url||item.source_key);
  const source_key=normalizedUrl(item.source_key||item.url);
  if(url!==source_key)continue;
  const title=String(item.title||'未命名網頁').slice(0,350);
  const content=item.content.trim();
  // Use per-item capture groups, not one group for unrelated posts.
  const group_id=await stableUuid(source_key+'\u0000'+(item.key||'')+'\u0000'+content);
  const partSize=85000,part_count=Math.ceil(content.length/partSize);
  if(part_count>10000)throw Error('文章過長');
  for(let index=0;index<part_count;index++){
   const part=content.slice(index*partSize,(index+1)*partSize);
   const id=await stableUuid(source_key+'\u0000'+(item.key||'')+'\u0000'+part+'\u0000'+index);
   rows.push({id,group_id,source_key,url,title,kind:'capture',write_mode:'append',
    part_index:index,part_count,captured_at:new Date().toISOString(),content:part});
  }
 }
 return rows;
}
function ready(rows){
 return rows.length && (new Set(rows.map(x=>x.group_id)).size>=AUTO_CAPTURE_COUNT ||
  sizeOf(rows)>=MAX_BYTES);
}
async function acceptItems(items){
 const events=await toEvents(items);
 if(!events.length)return {message:'沒有可擷取的內容'};
 await putEvents(events);
 const all=await allEvents();
 const paused=(await chrome.storage.local.get('locImportPaused')).locImportPaused;
 if(ready(all)&&!paused)void flush(false).catch(()=>{});
 return {message:'已加入 Queue：'+events.length+' 筆',queued:all.length};
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
async function locTab(){
 const tabs=await chrome.tabs.query({url:LOC_ORIGIN+'/*'});
 const candidates=tabs.filter(t=>{
  try{return new URL(t.url).origin===LOC_ORIGIN&&t.id!=null;}catch{return false;}
 });
 return candidates.find(t=>t.active)||candidates[0]||null;
}
// IMPORTANT: HTTP call runs in the LOC website's OWN origin and cookie context.
// No site Session, refresh token, JWT or Cookie is read by the extension.
async function sendViaWebsite(batch){
 const tab=await locTab();
 if(!tab)throw Error('請先開啟已登入的 LOC 網站；Queue 已保留');
 const result=await chrome.scripting.executeScript({
  target:{tabId:tab.id},world:'MAIN',
  func:async payload=>{
   try{
    const response=await fetch('/v1/import/short',{
     method:'POST',credentials:'same-origin',
     headers:{'content-type':'application/json','accept':'application/json'},
     body:JSON.stringify(payload),redirect:'error',cache:'no-store'
    });
    const body=await response.json().catch(()=>null);
    return {status:response.status,ok:response.ok,body};
   }catch(error){return {status:0,ok:false,error:String(error?.message||error)};}
  },args:[batch]
 });
 const reply=result?.[0]?.result;
 if(!reply?.ok){
  const message=reply?.status===401?'LOC 網站登入已失效':reply?.status===403?'LOC 沒有文章寫入權限':
   reply?.status===404?'LOC 尚未掛載網站短匯入 API':reply?.status===429?'LOC 寫入流量限制':
   'LOC 短匯入無法使用';
  throw Error(message+'（HTTP '+(reply?.status||0)+'）；Queue 保留');
 }
 if(!reply.body?.accepted||reply.body.id!==batch.id||
  !Array.isArray(reply.body.articles))throw Error('LOC 未確認完整批次回執；Queue 保留');
 const sourceKeys=new Set(batch.records.map(row=>row.source_key));
 const returned=new Map();
 for(const article of reply.body.articles||[]){
  if(typeof article?.source_key==='string'&&/^[A-Za-z0-9]{8}$/.test(article?.uid||''))
   returned.set(article.source_key,article.uid);
 }
 if([...sourceKeys].some(key=>!returned.has(key)))
  throw Error('LOC 未回傳所有文章 UID；Queue 保留');
}
async function flush(force){
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const rows=(await allEvents()).sort((a,b)=>a.captured_at.localeCompare(b.captured_at));
  if(!rows.length)return {message:'Queue 已清空'};
  if(!force&&!ready(rows))return {message:'未達批次門檻'};
  if(!force&&(await chrome.storage.local.get('locImportPaused')).locImportPaused)
   return {message:'自動傳送暫停；請手動檢查'};
  let count=0;
  try{
   for(const batchRows of packet(rows)){
    const batch={id:await stableUuid(batchRows.map(r=>r.id).sort().join('|')),
     write_mode:'append',records:batchRows};
    await sendViaWebsite(batch);
    await removeEvents(batchRows);
    count+=batchRows.length;
   }
   await chrome.storage.local.remove('locImportPaused');
   return {message:'已確認寫入 '+count+' 筆'};
  }catch(error){
   await chrome.storage.local.set({locImportPaused:true});
   throw error;
  }
 })().finally(()=>{inFlight=null;});
 return inFlight;
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
async function capture(tab,selection=''){
 await inject(tab.id);
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.capture',selection});
 if(!Array.isArray(reply?.items))throw Error('頁面沒有回傳內容');
 return acceptItems(reply.items);
}
async function selectOrRecord(type){
 const tab=await currentTab();
 await inject(tab.id);
 await chrome.tabs.sendMessage(tab.id,{type});
 return {message:type==='page.record'?'請點選錄製區域，開始追蹤動態貼文':'請點選要擷取的區域'};
}
async function stopRecording(){
 const tab=await currentTab();
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.stop'}).catch(()=>null);
 return {message:reply?.ok?'已停止錄製':'目前頁面沒有正在進行的錄製'};
}
chrome.runtime.onInstalled.addListener(()=>{
 chrome.contextMenus.removeAll().then(async()=>{
  chrome.contextMenus.create({id:MENU_PAGE,title:'將此網頁加入 LOC Queue',contexts:['page']});
  chrome.contextMenus.create({id:MENU_SELECTION,title:'將選取文字加入 LOC Queue',contexts:['selection']});
 }).catch(()=>{});
});
chrome.contextMenus.onClicked.addListener((info,tab)=>{
 if(!tab?.id||![MENU_PAGE,MENU_SELECTION].includes(info.menuItemId))return;
 void capture(tab,info.menuItemId===MENU_SELECTION?info.selectionText||'':'')
  .then(async()=>chrome.action.setBadgeText({text:'✓',tabId:tab.id}))
  .catch(async()=>chrome.action.setBadgeText({text:'!',tabId:tab.id}));
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 (async()=>{
  switch(message?.type){
   case 'items.captured':
    // Never trust web-page provided URLs other than those from the actual sender tab.
    if(sender.id!==chrome.runtime.id||!sender.tab?.url)throw Error('Invalid capture sender');
    if(new URL(sender.tab.url).origin!==new URL(message.items?.[0]?.url||'').origin)
     throw Error('Source origin mismatch');
    return acceptItems(message.items);
   case 'capture':return capture(await currentTab());
   case 'select':return selectOrRecord('page.select');
   case 'record.start':return selectOrRecord('page.record');
   case 'record.stop':return stopRecording();
   case 'queue.status':{
    const rows=await allEvents();
    return {count:rows.length,bytes:sizeOf(rows),
     paused:Boolean((await chrome.storage.local.get('locImportPaused')).locImportPaused)};
   }
   case 'queue.flush':return flush(true);
   case 'loc.open':
    await chrome.tabs.create({url:LOC_ORIGIN+'/local/settings/'});
    return {message:'已開啟 LOC 網站；網站 Session 由 LOC 自行管理'};
   default:throw Error('Unknown action');
  }
 })().then(respond).catch(error=>respond({error:String(error.message||error)}));
 return true;
});
