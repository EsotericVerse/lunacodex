const $=id=>document.getElementById(id);
const status=$('status'), queue=$('queue'), notice=$('notice');
const mcpProviders=$('mcpProviders');
const MCP_LABELS={neon:'Neon MCP',supabase:'Supabase MCP'};
function formatLocalActionTime(timestamp){
 const time=new Date(timestamp);
 if(!Number.isFinite(time.getTime()))return '—';
 const pad=value=>String(value).padStart(2,'0');
 return time.getFullYear()+'-'+pad(time.getMonth()+1)+'-'+pad(time.getDate())+
  ' '+pad(time.getHours())+':'+pad(time.getMinutes())+':'+pad(time.getSeconds());
}
function call(action,extra={}){return chrome.runtime.sendMessage({action,...extra});}
let lastProviderStatus=null;
function setAuthIndicator(connected){
 const badge=$('authStateBadge');
 badge.classList.toggle('state-connected',connected);
 badge.classList.toggle('state-waiting',!connected);
 badge.replaceChildren(badge.querySelector('.state-light'),
  document.createTextNode(connected?'已連接':'尚未連接'));
}
function renderMcpProviders(result){
 lastProviderStatus=result;
 mcpProviders.replaceChildren();
 if(result?.error||result?.ready!==true){
  const empty=document.createElement('div');
  empty.className='empty-state';
  empty.textContent=result?.error||'Gateway Provider Vault 尚未啟用。';
  mcpProviders.append(empty);
  return;
 }
 for(const id of Object.keys(MCP_LABELS)){
  const item=(result.providers||[]).find(row=>row.id===id)||{id,connected:false};
  const card=document.createElement('article');card.className='provider-card';
  const top=document.createElement('div');top.className='provider-card-top';
  const glyph=document.createElement('div');
  glyph.className='provider-mark provider-mark--'+id;
  glyph.setAttribute('aria-hidden','true');glyph.textContent=id==='neon'?'N':'S';
  const info=document.createElement('div');info.className='provider-info';
  const title=document.createElement('strong');title.textContent=MCP_LABELS[id];
  const state=document.createElement('span');
  state.className='provider-state'+(item.connected?' is-linked':'');
  state.textContent=item.connected?'已連接 · Gateway 可重用授權':'尚未連接';
  info.append(title,state);top.append(glyph,info);
  const actions=document.createElement('div');actions.className='provider-actions';
  const button=document.createElement('button');button.type='button';
  button.textContent=item.connected?'重新授權':'授權一次';
  button.disabled=!$('ssoEmail').value.trim();
  button.addEventListener('click',async()=>{
   const email=$('ssoEmail').value.trim();
   if(!email){notice.textContent='請先輸入上游服務登入 Email';return;}
   await chrome.storage.local.set({locSsoEmail:email});
   button.disabled=true;notice.textContent='正在連接 '+MCP_LABELS[id]+'…';
   try{
    const connected=await call('mcp-connect',{provider:id});
    notice.textContent=connected.error||'已連接 '+MCP_LABELS[id]+'；後續由 Gateway 重用授權。';
    await refreshMcp();
   }catch(error){notice.textContent=String(error?.message||error)}
   finally{button.disabled=!$('ssoEmail').value.trim();}
  });
  actions.append(button);
  if(item.connected){
   const disconnect=document.createElement('button');
   disconnect.type='button';disconnect.dataset.action='disconnect';
   disconnect.textContent='解除';
   disconnect.addEventListener('click',async()=>{
    disconnect.disabled=true;notice.textContent='正在解除 '+MCP_LABELS[id]+'…';
    try{
     await call('mcp-disconnect',{provider:id});
     notice.textContent='已解除 '+MCP_LABELS[id];
     await refreshMcp();
    }catch(error){notice.textContent=String(error?.message||error)}
    finally{disconnect.disabled=false;}
   });
   actions.append(disconnect);
  }
  card.append(top,actions);mcpProviders.append(card);
 }
}
async function refreshMcp(){
 try{renderMcpProviders(await call('mcp-status'))}
 catch(error){mcpProviders.textContent=String(error?.message||error)}
}
// Use the status already fetched for the six-key console: no extra polling.
let overviewStatus=null;
function renderOverviewGuidance(result){
 overviewStatus=result;
 const title=$('overview-next-title');
 const description=$('overviewNextDescription');
 const link=$('overviewNextLink');
 const recent=$('overviewRecent');
 const pending=Number(result.pendingCaptures)||0;
 let action=null;
 if(result.error){
  title.textContent='連線狀態需要檢查';
  description.textContent='目前無法確認連線與 Queue 狀態，請查看操作紀錄中的診斷資訊。';
  action={href:'#activity',label:'查看 Queue 與紀錄'};
 }else if(!result.connected){
  title.textContent='先建立 LOC 身分連線';
  description.textContent=pending
   ?'本機仍有 '+pending+' 次擷取待送。先使用上方「連接 LOC Auth」，Queue 會保留原有資料。'
   :'使用上方「連接 LOC Auth」完成授權。擷取時才會加入本機 Queue。';
 }else if(result.paused){
  title.textContent='Queue 暫時保留中';
  description.textContent='自動送出已暫停。請在 Queue 頁查看原因，需要時手動處理；原有資料不會因切頁而清除。';
  action={href:'#activity',label:'查看 Queue 狀態'};
 }else if(pending>0){
  title.textContent='有 '+pending+' 次擷取等待送出';
  description.textContent='內容已暫存在本機。可以前往 Queue 檢視送出情況與最近一次操作。';
  action={href:'#activity',label:'檢視待送資料'};
 }else{
  title.textContent='彩虹橋已可使用';
  description.textContent='在想保存的網頁或對話上按右鍵，選擇 LOC 彩虹橋的擷取功能。';
  action={href:'#capture',label:'查看擷取方法'};
 }
 link.hidden=!action;
 if(action){link.href=action.href;link.textContent=action.label+' →';}
 const last=result.lastAction;
 recent.textContent=last
  ?(last.ok?'成功':'失敗')+' · '+last.name+' · '+formatLocalActionTime(last.at)
  :'尚無操作紀錄';
}
async function show(){
 const [result,saved]=await Promise.all([
  call('loc-status'),
  chrome.storage.local.get(['locTargetScope','locIncludeAssistant','locSsoEmail'])
 ]);
 status.textContent=result.error||(result.connected?'已連接 LOC Auth':'尚未連接 LOC Auth');
 setAuthIndicator(Boolean(result.connected));
 $('captureCount').textContent=result.error?'—':String(result.pendingCaptures??0);
 $('itemCount').textContent=result.error?'—':String(result.pending??0);
 const cooldown=result.nextRetryAt>Date.now()?
  (result.retryReason==='server'?'；後端故障，自動重試延後至 ':'；流量管制至 ')+
  new Date(result.nextRetryAt).toLocaleString('zh-TW'):'';
 queue.textContent='待送 Queue：'+(result.pendingCaptures??0)+' 次擷取／'+(result.pending??0)+' 筆資料'+
  (result.paused?'；自動送出已暫停，原始 Queue 保留':'')+cooldown;
 renderOverviewGuidance(result);
 const last=result.lastAction;
 $('lastAction').textContent=last?
  (last.ok?'成功':'失敗')+' · '+last.name+' · '+formatLocalActionTime(last.at)+'\n'+last.message:
  '目前沒有操作紀錄。';
 $('scope').value=saved.locTargetScope||'lo3rwang';
 $('includeAI').checked=saved.locIncludeAssistant===true;
 $('ssoEmail').value=saved.locSsoEmail||'';
 await refreshMcp();
}
$('connect').addEventListener('click',async()=>{
 status.textContent='正在進行 LOC 授權…';
 try{
  const result=await call('loc-connect');
  status.textContent=result.error||(result.connected?'已連接 LOC Auth':'LOC 授權未完成');
  if(!result.error){
   setAuthIndicator(Boolean(result.connected));
   renderOverviewGuidance({...overviewStatus,connected:Boolean(result.connected),error:null});
  }
  await refreshMcp();
 }catch(error){status.textContent=String(error?.message||error);}
});
$('disconnect').addEventListener('click',async()=>{
 try{
  const result=await call('loc-disconnect');
  status.textContent=result.error||result.warning||
   (result.serverRevoked?'已撤銷伺服器授權；Queue 保留':'已解除連線；Queue 保留');
  if(!result.error){
   setAuthIndicator(false);
   renderOverviewGuidance({...overviewStatus,connected:false,error:null});
  }
 }catch(error){status.textContent=String(error?.message||error);}
});
$('refresh').addEventListener('click',()=>{
 void show().catch(error=>status.textContent=String(error?.message||error));
});
$('ssoEmail').addEventListener('input',()=>{
 if(lastProviderStatus)renderMcpProviders(lastProviderStatus);
});
$('ssoEmail').addEventListener('change',async()=>{
 await chrome.storage.local.set({locSsoEmail:$('ssoEmail').value.trim()});
 await refreshMcp();
});
$('scope').addEventListener('change',async()=>{
 const input=$('scope');
 if(!input.checkValidity()){notice.textContent='Scope ID 格式錯誤；未修改目的地';return;}
 try{
  const result=await chrome.runtime.sendMessage({type:'queue.scope',scopeid:input.value});
  notice.textContent=result.error||result.message||'目的 Scope 已儲存';
 }catch(error){notice.textContent=String(error?.message||error);}
});
$('includeAI').addEventListener('change',async()=>{
 await chrome.storage.local.set({locIncludeAssistant:$('includeAI').checked});
 notice.textContent=$('includeAI').checked?'已開啟 AI 回覆擷取':'只擷取使用者文字';
});
$('diagnostics').addEventListener('click',async()=>{
 try{
  const result=await call('loc-diagnostics');
  const text=JSON.stringify({captured_at:new Date().toISOString(),...result},null,2);
  await navigator.clipboard.writeText(text);
  notice.textContent='診斷紀錄已複製；可直接貼上提供紀錄。';
 }catch(error){notice.textContent='診斷紀錄複製失敗：'+String(error?.message||error);}
});
$('clearDiagnostics').addEventListener('click',async()=>{
 const button=$('clearDiagnostics');
 button.disabled=true;
 try{
  const result=await call('loc-clear-diagnostics');
  if(result?.cleared!==true)throw Error(result?.error||'無法確認紀錄已清理');
  $('lastAction').textContent='目前沒有操作紀錄。';
  if(overviewStatus)renderOverviewGuidance({...overviewStatus,lastAction:null});
  notice.textContent='已清理本機診斷紀錄；待送 Queue、授權與重試設定均保留。';
 }catch(error){notice.textContent='清理紀錄失敗：'+String(error?.message||error)}
 finally{button.disabled=false}
});
$('flush').addEventListener('click',async()=>{
 notice.textContent='正在送出 Queue…';
 try{
  const result=await call('loc-flush');
  await show();
  notice.textContent=result.error||result.message||'已處理';
 }catch(error){notice.textContent=String(error?.message||error);}
});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area==='local'&&changes.locLastAction?.newValue){
  void show().catch(error=>status.textContent=String(error?.message||error));
 }
});
show().catch(error=>status.textContent=String(error?.message||error));
