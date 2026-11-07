// Independent Chrome MV3 capture pipeline; no website login tokens or extension OAuth session.
// Internal storage key remains independent of MCP and product-facing name.
const DB_NAME='loc-web-capture-v2';
const STORE='events', ACK_STORE='acknowledged';
const MAX_BATCH=50, MAX_BYTES=600000, AUTO_CAPTURE_COUNT=10;
const LOC_ORIGIN='https://loc.lo3rwang.cc';
const LOC_BRIDGE=LOC_ORIGIN+'/extension/bridge/';
const MENU_PAGE='loc-page', MENU_SELECTION='loc-selection';
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
 const {locTargetScope='lo3rwang',locImportPaused=false}=
  await chrome.storage.local.get(['locTargetScope','locImportPaused']);
 const events=await toEvents(items,locTargetScope);
 if(!events.length)return {message:'沒有可擷取的內容'};
 const inserted=await putEvents(events);
 // When the website is unavailable, leave the queue alone and avoid
 // repeatedly loading/serializing every pending capture on each scroll.
 if(locImportPaused)return {message:'已保留 Queue：'+inserted+' 筆',queued:await queueCount()};
 const all=await allEvents();
 if(ready(all))void flush(false).catch(()=>{});
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
async function locTab(){
 const tabs=await chrome.tabs.query({url:LOC_BRIDGE+'*'});
 return tabs.find(tab=>{
  try{return tab.id!=null&&new URL(tab.url).href.startsWith(LOC_BRIDGE);}
  catch{return false;}
 })||null;
}
// Use LOC's EXISTING website auth adapter / delegated SQL gateway, not a
// second Extension OAuth or a fictitious same-origin cookie API.
// Only an explicitly opened, hydrated LOC bridge page can receive batches.
async function sendViaWebsite(envelope){
 const {scopeid,batch}=envelope;
 const tab=await locTab();
 if(!tab)throw Error('請先開啟 LOC 彩虹橋網站頁面；Queue 已保留');
 const result=await chrome.scripting.executeScript({
  target:{tabId:tab.id},world:'MAIN',
  func:async payload=>{
   if(location.origin!=='https://loc.lo3rwang.cc'||
      location.pathname!=='/extension/bridge/')
    return {ok:false,error:'LOC 彩虹橋頁面來源不符'};
   if(typeof window.__locGalaxyLinkImport!=='function')
    return {ok:false,error:'LOC 彩虹橋網站尚未完成載入'};
   try{
    const body=await window.__locGalaxyLinkImport(payload.batch,payload.scopeid);
    return {ok:true,body};
   }catch(error){return {ok:false,error:String(error?.message||error)};}
  },args:[envelope]
 });
 const reply=result?.[0]?.result;
 if(!reply?.ok)throw Error(String(reply?.error||'LOC 銀河寫入失敗')+'；Queue 保留');
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
   // Each network batch has exactly one destination Scope. One Queue,
   // but records acknowledged for one galaxy must not suppress another.
   for(const scopeid of [...new Set(rows.map(r=>r.scopeid||'lo3rwang'))]){
    for(const batchRows of packet(rows.filter(r=>(r.scopeid||'lo3rwang')===scopeid))){
     const batch={id:await stableUuid(batchRows.map(r=>r.id).sort().join('|')),
      write_mode:'append',records:batchRows.map(({scopeid:localScope,...record})=>record)};
     await sendViaWebsite({scopeid,batch});
     await removeEvents(batchRows);
     count+=batchRows.length;
    }
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
async function capture(tab,selection='',includeAssistant=false){
 await inject(tab.id);
 const reply=await chrome.tabs.sendMessage(tab.id,{type:'page.capture',selection,includeAssistant});
 if(!Array.isArray(reply?.items))throw Error('頁面沒有回傳內容');
 return acceptItems(reply.items);
}
async function recordedTab(){
 const {locRecorderTabId}=await chrome.storage.local.get('locRecorderTabId');
 if(Number.isInteger(locRecorderTabId)&&locRecorderTabId>0)
  return {id:locRecorderTabId};
 return currentTab();
}
async function selectOrRecord(type,includeAssistant=false){
 const tab=await currentTab();
 // One active recorder. Stop the prior tab before moving the recorder.
 const prior=(await chrome.storage.local.get('locRecorderTabId')).locRecorderTabId;
 if(type==='page.record'&&Number.isInteger(prior)&&prior!==tab.id)
  await chrome.tabs.sendMessage(prior,{type:'page.stop'}).catch(()=>{});
 await inject(tab.id);
 await chrome.tabs.sendMessage(tab.id,{type,includeAssistant});
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
    if(!Array.isArray(message.items)||!message.items.length||message.items.length>100)
     throw Error('Invalid capture items');
    if(message.items.some(item=>{
      try{return !captureSourceMatches(sender.tab.url,item?.url)||
        !captureSourceMatches(sender.tab.url,item?.source_key);}
      catch{return true;}
    }))throw Error('Source origin mismatch');
    return acceptItems(message.items);
   case 'capture':return capture(await currentTab(),'',message.includeAssistant===true);
   case 'select':return selectOrRecord('page.select',message.includeAssistant===true);
   case 'record.start':return selectOrRecord('page.record',message.includeAssistant===true);
   case 'record.pause':return controlRecording('page.pause');
   case 'record.resume':return controlRecording('page.resume');
   case 'record.stop':return stopRecording();
   case 'queue.status':{
    const rows=await allEvents();
    return {count:rows.length,bytes:sizeOf(rows),
     paused:Boolean((await chrome.storage.local.get('locImportPaused')).locImportPaused)};
   }
   case 'queue.scope':{
    const scopeid=String(message.scopeid||'');
    if(!SCOPE.test(scopeid))throw Error('不支援的銀河 Scope');
    await chrome.storage.local.set({locTargetScope:scopeid});
    return {message:'目的銀河：'+scopeid};
   }
   case 'queue.flush':return flush(true);
   case 'loc.open':
    await chrome.tabs.create({url:LOC_BRIDGE});
    return {message:'已開啟 LOC 彩虹橋網站授權與寫入頁面'};
   default:throw Error('Unknown action');
  }
 })().then(respond).catch(error=>respond({error:String(error.message||error)}));
 return true;
});
