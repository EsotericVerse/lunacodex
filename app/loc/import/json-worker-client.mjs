// A one-file, one-operation Worker for standalone JSON. Avoid blocking the
// React thread during TextDecoder/JSON.parse and do not cache decoded bodies.
// On settled/abort/error the Worker is terminated and its input is released.
export async function parseJsonImportOffMainThread(file,options={},{
  signal,onProgress
}={}){
  if(signal?.aborted)throw new Error('匯入檔案解析已取消');
  let worker;
  try{
    worker=new Worker(new URL('./json-import.worker.mjs',import.meta.url),{type:'module'});
  }catch{
    // Older native WebViews without module Worker support retain the existing
    // reader rather than silently losing the ability to import JSON.
    const {parseUniversalImportFile}=await import('./universal-file.mjs');
    if(signal?.aborted)throw new Error('匯入檔案解析已取消');
    return parseUniversalImportFile(file,options);
  }
  return new Promise((resolve,reject)=>{
    let finished=false;
    const release=()=>{
      if(finished)return false;
      finished=true;
      signal?.removeEventListener('abort',abort);
      worker.onmessage=null;
      worker.onerror=null;
      worker.onmessageerror=null;
      worker.terminate();
      return true;
    };
    const abort=()=>{
      if(release())reject(new Error('匯入檔案解析已取消'));
    };
    worker.onmessage=event=>{
      if(finished)return;
      const data=event.data||{};
      if(typeof data.stage==='string'){
        onProgress?.(data.stage);
        return;
      }
      if(Object.hasOwn(data,'error')){
        if(release())reject(new Error(String(data.error||'JSON 解析失敗')));
        return;
      }
      if(!Array.isArray(data.rows)){
        if(release())reject(new Error('JSON Worker 回傳資料格式不正確'));
        return;
      }
      if(release())resolve(data.rows);
    };
    worker.onerror=event=>{
      event?.preventDefault?.();
      if(release())reject(new Error('JSON Worker 解析失敗，請核對來源檔案格式'));
    };
    worker.onmessageerror=()=>{
      if(release())reject(new Error('JSON Worker 傳輸失敗，請縮小檔案後重試'));
    };
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    try{
      onProgress?.('正在讀取 JSON 檔案');
      worker.postMessage({file,options});
    }catch(error){
      if(release())reject(new Error('無法送出 JSON 解析工作：'+
        String(error?.message||error)));
    }
  });
}
