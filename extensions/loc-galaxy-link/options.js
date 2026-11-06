const status=document.querySelector('#status');
const queue=document.querySelector('#queue');
function call(action){return chrome.runtime.sendMessage({action});}
async function show(){
 const result=await call('loc-status');
 status.textContent=result.error|| (result.connected?'已連接 LOC，可使用網頁短匯入':'尚未連接 LOC');
 queue.textContent='待送 Queue：'+(result.pendingCaptures??0)+' 次擷取／'+(result.pending??0)+' 筆資料'+(result.paused?'；自動送出已暫停，請先確認授權或匯入回執':'');
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
document.querySelector('#flush').addEventListener('click',async()=>{
 status.textContent='正在送出累積的 Queue…';
 const result=await call('loc-flush');
 status.textContent=result.error||('已確認送達：'+result.sent+' 筆');
 await show();
});
show().catch(error=>status.textContent=error.message);
