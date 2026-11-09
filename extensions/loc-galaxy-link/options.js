const $=id=>document.getElementById(id);
const status=$('status'), queue=$('queue'), notice=$('notice');
function call(action){return chrome.runtime.sendMessage({action});}
async function show(){
 const [result,saved]=await Promise.all([
  call('loc-status'),
  chrome.storage.local.get(['locTargetScope','locIncludeAssistant'])
 ]);
 status.textContent=result.error||(result.connected?'已連接 LOC Auth':'尚未連接 LOC Auth');
 queue.textContent='待送 Queue：'+(result.pendingCaptures??0)+' 次擷取／'+(result.pending??0)+' 筆資料'+
  (result.paused?'；自動送出已暫停，原始 Queue 保留':'');
 $('scope').value=saved.locTargetScope||'lo3rwang';
 $('includeAI').checked=saved.locIncludeAssistant===true;
}
$('connect').addEventListener('click',async()=>{
 status.textContent='正在進行 LOC 授權…';
 try{
  const result=await call('loc-connect');
  status.textContent=result.error||(result.connected?'已連接 LOC Auth':'LOC 授權未完成');
 }catch(error){status.textContent=String(error?.message||error);}
});
$('disconnect').addEventListener('click',async()=>{
 try{
  const result=await call('loc-disconnect');
  status.textContent=result.error||result.warning||
   (result.serverRevoked?'已撤銷伺服器授權；Queue 保留':'已解除連線；Queue 保留');
 }catch(error){status.textContent=String(error?.message||error);}
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
$('flush').addEventListener('click',async()=>{
 status.textContent='正在送出 Queue…';
 try{
  const result=await call('loc-flush');
  await show();
  status.textContent=result.error||result.message||'已處理';
 }catch(error){status.textContent=String(error?.message||error);}
});
show().catch(error=>status.textContent=String(error?.message||error));
