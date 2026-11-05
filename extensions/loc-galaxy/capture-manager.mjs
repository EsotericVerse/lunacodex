import {extractOpenConversation} from './history-extract.mjs';
// Persistent, scope-bound pending queue. Only server success removes pending messages.
const ENABLED='locGalaxy.chatgptEnabled';
const PENDING='locGalaxy.capturePending';
const ALARM='locGalaxy.hourlySync';
const SCRIPT='loc-galaxy-chatgpt-observer';
const ORIGIN='https://chatgpt.com/*';
const SCOPE='locGalaxy.scopeid';
const ARCHIVED='locGalaxy.archiveSent';
let operations=Promise.resolve(),syncing=false;
function serial(fn){
  const task=operations.then(fn);
  operations=task.catch(()=>{});
  return task;
}
function validSource(sender){
  if(!sender?.tab?.id||sender.id!==chrome.runtime.id)return false;
  try{
    const url=new URL(sender.url||sender.tab.url||'');
    return url.origin==='https://chatgpt.com'&&
      /^\/((g\/[^/]+\/)?c\/)[a-zA-Z0-9-]{8,}/.test(url.pathname);
  }catch{return false;}
}
async function enable(){
  if(!await chrome.permissions.contains({origins:[ORIGIN]}))
    throw Error('請先在 Extension 工作台授權 ChatGPT 網站存取');
  // Replace an earlier registered version after an Extension update.
  await chrome.scripting.unregisterContentScripts({ids:[SCRIPT]}).catch(()=>{});
  await chrome.scripting.registerContentScripts([{
    id:SCRIPT,matches:[ORIGIN],js:['chatgpt-capture.js'],
    runAt:'document_idle',persistAcrossSessions:true
  }]);
  await chrome.storage.local.set({[ENABLED]:true});
  await chrome.alarms.create(ALARM,{periodInMinutes:60});
  const tabs=await chrome.tabs.query({url:[ORIGIN]});
  for(const tab of tabs){
    if(!tab.id)continue;
    await chrome.scripting.executeScript({target:{tabId:tab.id},
      files:['chatgpt-capture.js']}).catch(()=>{});
  }
  return {enabled:true};
}
async function disable(){
  await chrome.storage.local.set({[ENABLED]:false});
  await chrome.alarms.clear(ALARM);
  await chrome.scripting.unregisterContentScripts({ids:[SCRIPT]}).catch(()=>{});
  const tabs=await chrome.tabs.query({url:[ORIGIN]});
  await Promise.all(tabs.filter(tab=>tab.id).map(tab=>
    chrome.tabs.sendMessage(tab.id,{type:'locGalaxy.captureStop'}).catch(()=>{})));
  return {enabled:false};
}
export function captureController({record,authorized}){
  async function accept(message,sender){
    if(!validSource(sender))throw Error('來源不是已授權的 ChatGPT 分頁');
    const state=await chrome.storage.local.get([ENABLED,SCOPE]);
    if(state[ENABLED]!==true||!state[SCOPE])throw Error('擷取尚未啟用');
    const conversation_id=String(message.conversation_id||'');
    const message_id=String(message.message_id||'');
    const text=String(message.text||'');
    const time=String(message.observed_at||'');
    if(!/^chatgpt:[A-Za-z0-9-]{8,}$/.test(conversation_id)||
      !/^[A-Za-z0-9-]{8,}$/.test(message_id)||
      !text.trim()||text.length>20000||
      !Number.isFinite(Date.parse(time))||
      Math.abs(Date.now()-Date.parse(time))>120000)
      throw Error('來源資料格式或時間不正確');
    if(!String(sender.url||'').includes(conversation_id.slice(8)))
      throw Error('對話 ID 與分頁不一致');
    return serial(async()=>{
      const saved=await chrome.storage.local.get([PENDING,ARCHIVED]);
      const queue=Array.isArray(saved[PENDING])?saved[PENDING]:[];
      if(queue.some(row=>row.conversation_id===conversation_id&&row.message_id===message_id))
        return {queued:false,count:queue.length};
      if(queue.length>=500)throw Error('待同步佇列已達 500 則，請先同步');
      queue.push({scopeid:state[SCOPE],conversation_id,
        message_id,text,observed_at:time});
      await chrome.storage.local.set({[PENDING]:queue});
      return {queued:true,count:queue.length};
    });
  }
  async function archiveActive(){
    const state=await chrome.storage.local.get([SCOPE,ENABLED]);
    const scopeid=state[SCOPE];
    if(!scopeid)throw Error('請先選擇 LOC Scope');
    const auth=await authorized();
    if(!auth.ready||auth.scopeid!==scopeid)throw Error('Scope OAuth 尚未授權');
    if(!await chrome.permissions.contains({origins:[ORIGIN]}))
      throw Error('請先允許 ChatGPT 網站存取權');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]{8,}/.test(tab.url||''))
      throw Error('請先切換至欲封存的 ChatGPT 對話分頁');
    const outcome=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractOpenConversation});
    const snapshot=outcome?.[0]?.result;
    if(!snapshot||!/^chatgpt:[A-Za-z0-9-]{8,}$/.test(snapshot.conversation_id)||
       !tab.url.includes(snapshot.conversation_id.slice(8))||!Array.isArray(snapshot.records))
      throw Error('對話擷取結果無法核對來源');
    if(!snapshot.records.length)return {captured:0,queued:0,pending:(await status()).pending,partial:true};
    return serial(async()=>{
      const saved=await chrome.storage.local.get([PENDING,ARCHIVED,SCOPE]);
      if(saved[SCOPE]!==scopeid)throw Error('Scope 已切換，拒絕寫入舊對話');
      const queue=Array.isArray(saved[PENDING])?saved[PENDING]:[];
      const archived=saved[ARCHIVED]&&typeof saved[ARCHIVED]==='object'?saved[ARCHIVED]:{};
      const key=scopeid+':'+snapshot.conversation_id;
      const seen=new Set(Array.isArray(archived[key])?archived[key]:[]);
      for(const row of queue)if(row.scopeid===scopeid&&row.conversation_id===snapshot.conversation_id)seen.add(row.message_id);
      let queued=0,bytes=0;
      const start=Date.now()-snapshot.records.length-100;
      for(let i=0;i<snapshot.records.length;i++){
        const row=snapshot.records[i];
        if(!/^[A-Za-z0-9-]{8,}$/.test(String(row.message_id||''))||
          !['user','assistant'].includes(row.role)||typeof row.text!=='string'||
          !row.text.trim()||row.text.length>80000||seen.has(row.message_id))continue;
        const size=row.text.length;
        if(queue.length>=500||bytes+size>1800000)break;
        queue.push({scopeid,conversation_id:snapshot.conversation_id,
          message_id:row.message_id,text:row.text,role:row.role,
          observed_at:new Date(start+i).toISOString()});
        bytes+=size;queued++;seen.add(row.message_id);
      }
      await chrome.storage.local.set({[PENDING]:queue});
      return {captured:snapshot.records.length,queued,pending:queue.length,
        partial:snapshot.partial||queued<snapshot.records.filter(row=>!Array.isArray(archived[key])||!archived[key].includes(row.message_id)).length};
    });
  }
  async function status(){
    const state=await chrome.storage.local.get([ENABLED,PENDING]);
    return {enabled:state[ENABLED]===true,
      pending:Array.isArray(state[PENDING])?state[PENDING].length:0,syncing};
  }
  async function sync(){
    if(syncing)return {busy:true};
    syncing=true;
    let completed=0;
    try{
      const ready=await authorized();
      if(!ready.ready)throw Error('OAuth／Scope 授權尚未通過');
      const state=await chrome.storage.local.get([ENABLED,PENDING,SCOPE]);
      if(state[ENABLED]!==true)return {completed:0,disabled:true};
      const scopeid=state[SCOPE];
      const items=(Array.isArray(state[PENDING])?state[PENDING]:[])
        .filter(row=>row.scopeid===scopeid);
      const ids=[...new Set(items.map(row=>row.conversation_id))];
      for(const id of ids){
        const rows=items.filter(row=>row.conversation_id===id)
          .sort((a,b)=>a.observed_at.localeCompare(b.observed_at));
        // Conservative batches: at most 30 messages / 70KB.
        let batch=[];
        for(const row of rows){
          const candidate=[...batch,row];
          if(batch.length&& (candidate.length>30||
             JSON.stringify(candidate).length>70000)){
            completed+=await sendBatch(id,batch,scopeid);
            batch=[];
          }
          batch.push(row);
        }
        if(batch.length)completed+=await sendBatch(id,batch,scopeid);
      }
      const stateAfter=await status();
      return {completed,pending:stateAfter.pending,enabled:true,syncing:false};
    }finally{syncing=false;}
  }
  async function sendBatch(id,rows,scopeid){
    const last=rows[rows.length-1].observed_at;
    // Observed time, not a claim of historical platform send time.
    const conversation={conversation_id:id,updated_at:last,
      records:rows.map(row=>({role:row.role||'user',
        kind:row.role==='assistant'?'advice':'original',
        message_id:row.message_id,sent_at:row.observed_at,text:row.text}))};
    const result=await record({scopeid,conversation});
    if(result.saved!==true&&result.unchanged!==true)
      throw Error('LOC 尚未確認寫入');
    await serial(async()=>{
      const saved=await chrome.storage.local.get([PENDING,ARCHIVED]);
      const queue=Array.isArray(saved[PENDING])?saved[PENDING]:[];
      const sent=new Set(rows.map(row=>row.message_id));
      const archived=saved[ARCHIVED]&&typeof saved[ARCHIVED]==='object'?saved[ARCHIVED]:{};
      const key=scopeid+':'+id;
      const known=new Set(Array.isArray(archived[key])?archived[key]:[]);
      for(const row of rows)known.add(row.message_id);
      archived[key]=[...known].slice(-6000);
      await chrome.storage.local.set({[ARCHIVED]:archived,
        [PENDING]:queue.filter(row=>
          !(row.scopeid===scopeid&&row.conversation_id===id&&sent.has(row.message_id)))});
    });
    return rows.length;
  }
  async function clearOnScopeChange(){
    await disable();
    await serial(()=>chrome.storage.local.remove([PENDING,ARCHIVED]));
  }
  async function resume(){
    const state=await chrome.storage.local.get(ENABLED);
    if(state[ENABLED]===true&&await chrome.permissions.contains({origins:[ORIGIN]})){
      await chrome.alarms.create(ALARM,{periodInMinutes:60});
    }else if(state[ENABLED]===true)await disable();
  }
  return {enable,disable,accept,archiveActive,status,sync,clearOnScopeChange,resume,ALARM};
}
