const $=id=>document.getElementById(id);
async function call(type){
 try{
  const result=await chrome.runtime.sendMessage({type:type==='queue.scope.change'?'queue.scope':type,scopeid:$('scope').value,includeAssistant:$('includeAI').checked});
  if(result?.error)throw Error(result.error);
  $('status').textContent=result?.message||'完成';
 }catch(error){$('status').textContent=String(error.message||error);}
 await stats();
}
async function stats(){
 const s=await chrome.runtime.sendMessage({type:'queue.status'}).catch(()=>({}));
 $('stats').textContent='待送：'+(s.count??'?')+' 筆，約 '+Math.ceil((s.bytes||0)/1024)+' KB'+(s.paused?'（傳送暫停）':'');
}
for(const [id,type] of Object.entries({capture:'capture',select:'select',record:'record.start',pause:'record.pause',resume:'record.resume',stop:'record.stop',send:'queue.flush'}))
 $(id).addEventListener('click',()=>call(type));
chrome.storage.local.get('locIncludeAssistant').then(v=>{$('includeAI').checked=Boolean(v.locIncludeAssistant);}).catch(()=>{});
$('includeAI').addEventListener('change',()=>chrome.storage.local.set({locIncludeAssistant:$('includeAI').checked}));
chrome.storage.local.get('locTargetScope').then(v=>{$('scope').value=v.locTargetScope||'lo3rwang';}).catch(()=>{});
$('scope').addEventListener('change',()=>call('queue.scope.change'));
void stats();

async function authView(){const r=await chrome.runtime.sendMessage({action:'loc-status'});$('authStatus').textContent=r.error||(r.connected?'已連接 LOC Auth':'尚未連接 LOC Auth')}
$('connect').addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({action:'loc-connect'});$('authStatus').textContent=r.error||(r.connected?'已連接 LOC Auth':'登入未完成')});
$('disconnect').addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({action:'loc-disconnect'});$('authStatus').textContent=r.error||r.warning||'已解除 LOC 連線；Queue 保留'});
void authView();
