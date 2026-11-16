// One-time recovery for a page kept open across a Next.js static deployment.
// Never reload for network/API failures or ordinary React errors.
const RELOAD_WINDOW_MS=2*60*1000;
const KEY_PREFIX='loc-chunk-recovery:';
export function isChunkLoadFailure(error){
  const message=String(error?.message||error||'');
  return /ChunkLoadError|Failed to load chunk|Loading chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
}
export function recoverChunkOnce(error,{
  browser=typeof window!=='undefined'?window:null,now=Date.now()
}={}){
  if(!isChunkLoadFailure(error)||!browser||!/^https?:$/.test(browser.location?.protocol||''))throw error;
  const key=KEY_PREFIX+browser.location.pathname;
  let last;
  try{last=Number(browser.sessionStorage.getItem(key)||0);}
  catch{throw error;}
  if(last&&now-last<RELOAD_WINDOW_MS)throw error;
  const editing=new URLSearchParams(browser.location.search||'').get('edit')==='1';
  if(editing&&!browser.confirm('新版頁面的模組載入失敗，需要重新整理。尚未儲存的編輯內容可能遺失，要重新整理嗎？'))throw error;
  try{browser.sessionStorage.setItem(key,String(now));}
  catch{throw error;}
  browser.location.reload();
  // Avoid throwing a second error while the fresh document is loading.
  return new Promise(()=>{});
}
