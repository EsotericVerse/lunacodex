// Generic JSON file decoding only. CMS field mapping and Galaxy/Anchor writes
// remain in their existing modules; this worker owns no database or auth APIs.
// The parent terminates this worker after success, error, or cancellation.
import {parseUniversalImportFile} from './universal-file.mjs';

self.onmessage=async event=>{
  const {file,options}=event.data||{};
  try{
    self.postMessage({stage:'正在解碼 JSON'});
    const rows=await parseUniversalImportFile(file,options);
    self.postMessage({rows});
  }catch(error){
    // No raw article data in error messages or logs.
    self.postMessage({error:String(error?.message||error||'JSON 解析失敗')});
  }
};
