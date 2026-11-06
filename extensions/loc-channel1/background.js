const MENU='loc-channel1-save';
const notify=async(message)=>{await chrome.action.setBadgeText({text:message==='ok'?'OK':'!'});await chrome.action.setBadgeBackgroundColor({color:message==='ok'?'#18794e':'#a13b3b'});};
chrome.runtime.onInstalled.addListener(async()=>{
 chrome.contextMenus.removeAll(()=>{
  chrome.contextMenus.create({id:MENU,title:'LOC：解析並儲存此頁',contexts:['page']});
 });
 await chrome.alarms.create('loc-channel1-retry',{periodInMinutes:5});
});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function snapshot(tabId){
 const result=await chrome.scripting.executeScript({target:{tabId},func:()=>{
  const root=document.querySelector('main, [role="main"]')||document.querySelector('article');
  if(!root)return {error:'找不到主要內容區域，未儲存，以免誤存導覽或其他文字'};
  const excluded='script,style,noscript,nav,header,footer,aside,button,input,textarea,select,option,[role="navigation"],[role="menu"],[role="toolbar"],[aria-hidden="true"]';
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const parts=[];let node;
  while((node=walker.nextNode())){
   const parent=node.parentElement;
   if(!parent||parent.closest(excluded))continue;
   const style=getComputedStyle(parent);
   if(style.display==='none'||style.visibility==='hidden')continue;
   const s=node.textContent.replace(/\s+/g,' ').trim();
   if(s)parts.push(s);
  }
  const content=parts.join('\n').trim();
  if(!content)return {error:'頁面主要內容尚未載入或沒有可解析文字'};
  if(content.length>600000)return {error:'頁面內容超過單筆限制，請勿截斷保存；需改走批次模式'};
  return {url:location.href,title:document.title,content,captured_at:new Date().toISOString(),
   source:location.hostname,extraction:'dom-main-content',completeness:'loaded-dom-only'};
 }});
 const data=result?.[0]?.result;
 if(data?.error)throw Error(data.error);
 return data;
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
 (async()=>{const record=await snapshot(tab.id);if(!record?.content)throw Error('頁面無可保存文字');await enqueue(record);await drain();await notify('ok');})().catch(async e=>{console.error('LOC KV save',e);await notify('error');});
});
chrome.alarms.onAlarm.addListener(event=>{if(event.name==='loc-channel1-retry')drain().catch(e=>console.warn('LOC KV retry',e.message));});
