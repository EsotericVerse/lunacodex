const scopeInput=document.getElementById('scopeid');
const status=document.getElementById('status');
const loginButton=document.getElementById('login');
const authorizeButton=document.getElementById('authorize');
const disconnectButton=document.getElementById('disconnect');
const workbenchButton=document.getElementById('workbench');
const archiveButton=document.getElementById('archive-current');
const importButton=document.getElementById('import');
const bulkButton=document.getElementById('bulk');
const connected=document.getElementById('connected');
const account=document.getElementById('account');
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
let busy=false;

async function call(type,scopeid,params={}){
  const reply=await chrome.runtime.sendMessage({type,scopeid,...params});
  if(!reply||reply.ok!==true)throw Error(reply?.error||'LOC Galaxy 連線失敗');
  return reply.data||{};
}
function setBusy(on){
  busy=on;
  for(const button of [loginButton,authorizeButton,disconnectButton,workbenchButton,archiveButton,importButton,bulkButton])button.disabled=on;
  scopeInput.disabled=on;
}
function validScope(){
  const id=scopeInput.value.trim().toLowerCase();
  if(!SCOPE.test(id))throw Error('請輸入有效的 Scope ID（小寫英數、最多 15 碼）。');
  return id;
}
function show(message,{error=false}={}){
  status.textContent=message;
  status.style.color=error?'#9a2d2d':'#555';
}
function render(data){
  if(data.scopeid&&!scopeInput.value)scopeInput.value=data.scopeid;
  const same=Boolean(data.scopeid&&data.scopeid===scopeInput.value.trim());
  connected.hidden=!(data.ready&&same);
  if(data.ready&&same){
    account.textContent='Scope: '+data.scopeid+' · Clerk: '+data.subject;
    show('Scope 已授權，可使用 Galaxy 工作台及既有網站的資料匯入／大量更新。');
  }else if(data.temporary_unavailable)
    show('暫時無法確認連線；已保留授權狀態，網路恢復後再試。',{error:true});
  else show('先使用 LOC 完整登入畫面，再完成專用 OAuth 授權。');
}
async function operation(type){
  if(busy)return;
  try{
    const id=validScope();setBusy(true);
    show(type==='login'?'正在開啟 LOC 登入畫面…':'正在以 Clerk OAuth 驗證 Scope…');
    const next=await call(type,id);
    if(type==='login')show('請在開啟的 LOC 頁面登入，再回來按「驗證 OAuth 並連線」。');
    else render(next);
  }catch(error){show(String(error.message||error),{error:true});}
  finally{setBusy(false);}
}
async function openWork(type,mode){
  if(busy)return;
  try{
    const id=validScope();
    setBusy(true);
    await call(type,id,mode?{mode}:{});
    show('工作頁面已在新分頁開啟。');
  }catch(error){show(String(error.message||error),{error:true});}
  finally{setBusy(false);}
}
archiveButton.addEventListener('click',async()=>{
  if(busy)return;
  try{
    validScope();
    const grant=await chrome.permissions.request({origins:['https://chatgpt.com/*']});
    if(!grant){show('尚未授權 ChatGPT 網站，沒有擷取任何內容。',{error:true});return;}
    setBusy(true);
    show('正在讀取目前 ChatGPT 對話的可見歷史，並準備寫入 Galaxy…');
    const result=await call('locGalaxy.archiveCurrent',validScope());
    const count=Number(result.captured||0),queued=Number(result.queued||0);
    const completed=Number(result.sync?.completed||0);
    show('已掃描 '+count+' 則，新增暫存 '+queued+' 則，確認寫入 '+completed+
      ' 則。'+(result.partial?' 網站歷史可能未全部載入。':' 已完成頁面範圍掃描（不保證來源歷史完整）。')+
      (result.syncError?' 同步待重試：'+result.syncError:''));
  }catch(error){show('封存未完成：'+String(error.message||error),{error:true});}
  finally{setBusy(false);}
});
workbenchButton.addEventListener('click',()=>openWork('locGalaxy.openWorkbench'));
importButton.addEventListener('click',()=>openWork('locGalaxy.openWorkspace','import'));
bulkButton.addEventListener('click',()=>openWork('locGalaxy.openWorkspace','bulk'));
loginButton.addEventListener('click',()=>operation('locGalaxy.openLogin'));
authorizeButton.addEventListener('click',()=>operation('locGalaxy.authorize'));
disconnectButton.addEventListener('click',async()=>{
  if(busy)return;
  try{
    setBusy(true);
    await call('locGalaxy.disconnect');
    connected.hidden=true;
    show('Extension 已中斷連線；LOC 網站登入狀態不受影響。');
  }catch(error){show(String(error.message||error),{error:true});}
  finally{setBusy(false);}
});
scopeInput.addEventListener('input',()=>{
  connected.hidden=true;
  show('更換 Scope 後，需要重新取得該 Scope 的授權。');
});
void call('locGalaxy.status').then(render).catch(error=>
  show(String(error.message||error),{error:true})
);
