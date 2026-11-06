const MENU='loc-channel1-save';
const DB_NAME='loc-channel1-queue',STORE='pending';
const MAX_BATCH_BYTES=600000, MAX_TEXT_CHARS=140000;
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
async function flush(){
 if(processing)return processing;
 processing=(async()=>{
  const {endpoint,token}=await chrome.storage.local.get(['endpoint','token']);
  if(!endpoint||!token)throw Error('尚未設定 KV Worker URL 與寫入 Token');
  const pending=(await allPending()).sort((a,b)=>a.captured_at.localeCompare(b.captured_at));
  for(const records of batches(pending)){
   const batch={id:await stableBatchId(records),records};
   const reply=await fetch(endpoint.replace(/\/$/,'')+'/v1/batch',{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify(batch)
   });
   if(!reply.ok)throw Error('KV 寫入失敗：HTTP '+reply.status);
   const result=await reply.json();
   if(!result.accepted||result.id!==batch.id)throw Error('KV 未確認批次寫入');
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
  flush().then(count=>{if(count)badge(true,'已送達 KV：'+count+' 筆');}).catch(err=>{
   console.warn('[LOC Queue retry]',err.message);badge(false,err.message);
  });
});
