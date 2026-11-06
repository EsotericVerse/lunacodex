const MENU='loc-channel1-save';
const notify=async(message)=>{await chrome.action.setBadgeText({text:message==='ok'?'OK':'!'});await chrome.action.setBadgeBackgroundColor({color:message==='ok'?'#18794e':'#a13b3b'});};
chrome.runtime.onInstalled.addListener(async()=>{chrome.contextMenus.create({id:MENU,title:'LOC：儲存此頁至 KV',contexts:['page','selection']});await chrome.alarms.create('loc-channel1-retry',{periodInMinutes:5});});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function snapshot(tabId,selectedText){
 const result=await chrome.scripting.executeScript({target:{tabId},func:(selection)=>{
  const text=(document.querySelector('main')||document.querySelector('article')||document.body)?.innerText||'';
  return {url:location.href,title:document.title,content:(selection||text).slice(0,600000),captured_at:new Date().toISOString(),source:location.hostname,completeness:'visible-page-only'};
 },args:[selectedText||'']});
 return result?.[0]?.result;
}
async function enqueue(record){
 const id=crypto.randomUUID();await chrome.storage.local.set({['pending:'+id]:{id,...record}});return id;
}
let draining;
async function drain(){
 if(draining)return draining;
 draining=(async()=>{
  const {endpoint,token}=await chrome.storage.local.get(['endpoint','token']);
  if(!endpoint||!token)throw Error('請先設定 Worker URL 與 Token');
  const all=await chrome.storage.local.get(null);
  for(const [key,record] of Object.entries(all).filter(([k])=>k.startsWith('pending:')).sort(([a],[b])=>a.localeCompare(b))){
   const response=await fetch(endpoint+'/v1/record',{method:'POST',headers:{'authorization':'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(record)});
   if(!response.ok)throw Error('Worker '+response.status);
   await chrome.storage.local.remove(key);
  }
 })().finally(()=>{draining=null;});
 return draining;
}
chrome.contextMenus.onClicked.addListener((info,tab)=>{
 if(info.menuItemId!==MENU||!tab?.id)return;
 (async()=>{const record=await snapshot(tab.id,info.selectionText);if(!record?.content)throw Error('頁面無可保存文字');await enqueue(record);await drain();await notify('ok');})().catch(async e=>{console.error('LOC KV save',e);await notify('error');});
});
chrome.alarms.onAlarm.addListener(event=>{if(event.name==='loc-channel1-retry')drain().catch(e=>console.warn('LOC KV retry',e.message));});
