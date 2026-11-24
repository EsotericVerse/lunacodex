// One-time recovery for a page kept open across a Next.js static deployment.
// Never reload for network/API failures or ordinary React errors.
export function isChunkLoadFailure(error){
  const message=String(error?.message||error||'');
  return /ChunkLoadError|Failed to load chunk|Loading chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
}
export function recoverChunkOnce(error,{
  browser=typeof window!=='undefined'?window:null
}={}){
  if(!isChunkLoadFailure(error)||!browser||!/^https?:$/.test(browser.location?.protocol||''))throw error;
  // A reload already attempted for this document must not loop. This uses
  // the browser's navigation type and does not write visitor Session data.
  const navigation=browser.performance?.getEntriesByType?.('navigation')?.[0];
  if(!navigation||navigation.type==='reload')throw error;
  // On Scope homepages EditDock can be active without the ?edit=1 URL
  // parameter. Use its live document marker before any automatic refresh.
  const editing=new URLSearchParams(browser.location.search||'').get('edit')==='1'||
    browser.document?.documentElement?.dataset?.locEditing==='true';
  if(editing&&(
    typeof browser.confirm!=='function'||
    !browser.confirm('新版頁面的模組載入失敗，需要重新整理。尚未儲存的編輯內容可能遺失，要重新整理嗎？')
  ))throw error;
  browser.location.reload();
  // Avoid throwing a second error while the fresh document is loading.
  return new Promise(()=>{});
}
