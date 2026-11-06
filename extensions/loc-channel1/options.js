const status=document.querySelector('#status');
function call(action){return chrome.runtime.sendMessage({action});}
async function show(){
 const result=await call('loc-status');
 status.textContent=result.error|| (result.connected?'已連接 LOC，可使用網頁短匯入':'尚未連接 LOC');
}
document.querySelector('#connect').addEventListener('click',async()=>{
 status.textContent='正在進行 LOC 授權…';
 const result=await call('loc-connect');
 status.textContent=result.error|| (result.connected?'已連接 LOC':'LOC 授權未完成');
});
document.querySelector('#disconnect').addEventListener('click',async()=>{
 const result=await call('loc-disconnect');
 status.textContent=result.error||'已解除 LOC 連線';
});
show().catch(error=>status.textContent=error.message);
