const $=id=>document.getElementById(id);
async function call(type){
 try{
  const result=await chrome.runtime.sendMessage({type});
  if(result?.error)throw Error(result.error);
  $('status').textContent=result?.message||'完成';
 }catch(error){$('status').textContent=String(error.message||error);}
 await stats();
}
async function stats(){
 const s=await chrome.runtime.sendMessage({type:'queue.status'}).catch(()=>({}));
 $('stats').textContent='待送：'+(s.count??'?')+' 筆，約 '+Math.ceil((s.bytes||0)/1024)+' KB'+(s.paused?'（傳送暫停）':'');
}
for(const [id,type] of Object.entries({capture:'capture',select:'select',record:'record.start',pause:'record.pause',resume:'record.resume',stop:'record.stop',send:'queue.flush',login:'loc.open'}))
 $(id).addEventListener('click',()=>call(type));
void stats();
