const $=id=>document.getElementById(id);
const status=$('status'), queue=$('queue'), notice=$('notice');
const mcpProviders=$('mcpProviders');
const MCP_LABELS={neon:'Neon MCP',supabase:'Supabase MCP'};
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
 const last=result.lastAction;
 $('lastAction').textContent=last?
  (last.ok?'成功':'失敗')+' · '+last.name+' · '+(last.at||'').replace('T',' ').slice(0,19)+'\n'+last.message:
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
  if(!result.error)setAuthIndicator(Boolean(result.connected));
  await refreshMcp();
 }catch(error){status.textContent=String(error?.message||error);}
});
$('disconnect').addEventListener('click',async()=>{
 try{
  const result=await call('loc-disconnect');
  status.textContent=result.error||result.warning||
   (result.serverRevoked?'已撤銷伺服器授權；Queue 保留':'已解除連線；Queue 保留');
  if(!result.error)setAuthIndicator(false);
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
$('flush').addEventListener('click',async()=>{
 notice.textContent='正在送出 Queue…';
 try{
  const result=await call('loc-flush');
  await show();
  notice.textContent=result.error||result.message||'已處理';
 }catch(error){notice.textContent=String(error?.message||error);}
});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area==='local'&&changes.locLastAction){
  void show().catch(error=>status.textContent=String(error?.message||error));
 }
});
show().catch(error=>status.textContent=String(error?.message||error));
