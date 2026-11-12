// Private iOS Local File store. It has NO Supabase/Neon, network, OAuth or browser storage imports.
// Dependencies are injected so the complete file lifecycle can be tested without an iPhone.
// The caller must supply Capacitor Filesystem and Directory.LibraryNoCloud (not Documents/Cache).
import {detectPrivateFileContent,PRIVATE_SNIFF_BYTES} from './private-file-detection.mjs';
export const PRIVATE_FILE_ROOT='loc-private-files/v1';
export const PRIVATE_FILE_INDEX=PRIVATE_FILE_ROOT+'/index.json';
export const PRIVATE_FILE_CHUNK_BYTES=256*1024;
export const PRIVATE_PREVIEW_MAX_BYTES=512*1024;
// A full File materialization is bounded; large originals remain accessible
// in place through getUri(), without uploading or copying them to a service.
export const PRIVATE_FILE_READ_MAX_BYTES=64*1024*1024;

const FILE_ID=/^[a-f0-9]{32}$/;
const TEXT_FILE=/\.(?:txt|log|json|jsonl|xml|html?|md|csv|tsv|ini|yaml|yml|srt|vtt)$/i;
const utf8='utf8';
const errorMessage=error=>String(error?.message||error||'');
const missing=error=>/not found|does not exist|no such file|enoent|not exist/i.test(errorMessage(error));

export function privateFilePath(id){
  if(!FILE_ID.test(String(id||'')))throw new Error('無效的本機檔案 ID。');
  return PRIVATE_FILE_ROOT+'/files/'+id+'.bin';
}

export function isTextPrivateFile(entry){
  // New entries use actual sampled bytes, regardless of extension or MIME.
  if(entry?.detection&&typeof entry.detection.textual==='boolean')return entry.detection.textual;
  // Historical records without sniff data retain backward-compatible preview.
  return TEXT_FILE.test(String(entry?.name||''))||/^text\//i.test(String(entry?.type||''));
}

function newId(){
  if(typeof crypto==='undefined'||typeof crypto.getRandomValues!=='function')throw new Error('裝置不支援安全隨機檔案識別碼。');
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

function toBase64(bytes){
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary);
}

function fromBase64(text){
  const binary=atob(text);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function normalizedIndex(value){
  if(!value||value.version!==1||!Array.isArray(value.files))throw new Error('本機索引格式不正確；為保護原始檔案，已停止寫入。');
  const ids=new Set();
  return value.files.map(entry=>{
    if(!entry||!FILE_ID.test(entry.id)||ids.has(entry.id)||
      typeof entry.name!=='string'||!Number.isSafeInteger(entry.size)||entry.size<0)
      throw new Error('本機索引資料損壞；已停止操作，避免覆蓋私人檔案。');
    ids.add(entry.id);
    return {
      id:entry.id,name:entry.name,size:entry.size,
      type:typeof entry.type==='string'?entry.type:'',
      lastModified:Number.isFinite(entry.lastModified)?entry.lastModified:null,
      importedAt:typeof entry.importedAt==='string'?entry.importedAt:'',
      detection:entry.detection&&typeof entry.detection.kind==='string'&&
        typeof entry.detection.textual==='boolean'&&typeof entry.detection.label==='string'
        ?{kind:entry.detection.kind,label:entry.detection.label,
          encoding:typeof entry.detection.encoding==='string'?entry.detection.encoding:'',
          textual:entry.detection.textual,
          certainty:typeof entry.detection.certainty==='string'?entry.detection.certainty:'low',
          reason:typeof entry.detection.reason==='string'?entry.detection.reason:''}:null
    };
  });
}

export function createPrivateLocalStore(filesystem,directory){
  if(!filesystem||!directory)throw new Error('缺少 iOS 原生檔案儲存能力。');
  const fs=filesystem;
  const options=path=>({path,directory});

  async function ensureFilesFolder(){
    for(const path of [PRIVATE_FILE_ROOT,PRIVATE_FILE_ROOT+'/files']){
      try{await fs.stat(options(path));}
      catch(error){
        if(!missing(error))throw error;
        try{await fs.mkdir({...options(path),recursive:true});}
        catch(mkdirError){await fs.stat(options(path));}
      }
    }
  }

  async function readIndex(){
    try{await fs.stat(options(PRIVATE_FILE_INDEX));}
    catch(error){if(missing(error))return [];throw error;}
    const result=await fs.readFile({...options(PRIVATE_FILE_INDEX),encoding:utf8});
    if(typeof result?.data!=='string')throw new Error('無法讀取本機索引。');
    let parsed;
    try{parsed=JSON.parse(result.data);}catch{throw new Error('本機索引 JSON 損壞；已停止操作。');}
    return normalizedIndex(parsed);
  }

  async function writeIndex(files){
    await fs.writeFile({...options(PRIVATE_FILE_INDEX),data:JSON.stringify({version:1,files}),encoding:utf8});
  }

  async function list(){
    await ensureFilesFolder();
    return (await readIndex()).sort((a,b)=>b.importedAt.localeCompare(a.importedAt));
  }

  async function readBinary(entry){
    const result=await fs.readFile(options(privateFilePath(entry.id)));
    if(typeof result?.data!=='string')throw new Error('本機檔案讀取失敗。');
    let bytes;
    try{bytes=fromBase64(result.data);}
    catch{throw new Error('本機檔案二進位資料無法解碼。');}
    if(bytes.byteLength!==entry.size)throw new Error('本機檔案內容與保存大小不一致。');
    return bytes;
  }

  // Reopen the exact original bytes as a browser File. Existing offline
  // parsers can consume its slice()/arrayBuffer() interface unchanged.
  async function readFile(id,{maxBytes=PRIVATE_FILE_READ_MAX_BYTES}={}){
    const path=privateFilePath(id);
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>PRIVATE_FILE_READ_MAX_BYTES)
      throw new Error('無效的本機檔案讀取上限。');
    const entry=(await list()).find(item=>item.id===id);
    if(!entry)throw new Error('找不到本機檔案。');
    if(entry.size>maxBytes)
      throw new Error('本機檔案過大，請使用 getUri() 直接存取原檔。');
    const bytes=await readBinary(entry);
    return new File([bytes],entry.name,{
      type:entry.type||'',lastModified:entry.lastModified??Date.now()
    });
  }

  async function importFile(file,onProgress){
    if(!file||typeof file.slice!=='function'||!Number.isSafeInteger(file.size)||file.size<0)
      throw new Error('選擇的檔案無法讀取。');
    const name=String(file.name||'');
    if(!name||name.length>500)throw new Error('檔案名稱不正確或過長。');
    await ensureFilesFolder();
    const before=await readIndex(); // Never overwrite a damaged index.
    // Detect on a bounded prefix only. The original file is copied unchanged.
    const sample=new Uint8Array(await file.slice(0,Math.min(file.size,PRIVATE_SNIFF_BYTES)).arrayBuffer());
    const detection=detectPrivateFileContent(sample);
    let id;
    do{id=newId();}while(before.some(item=>item.id===id));
    const path=privateFilePath(id);
    const entry={
      id,name,size:file.size,type:String(file.type||''),
      lastModified:Number.isFinite(file.lastModified)?file.lastModified:null,
      importedAt:new Date().toISOString(),detection
    };
    let created=false;
    try{
      // Chunked binary copy: keep the original bytes; never decode as JSON/text.
      for(let offset=0;offset<file.size||offset===0;offset+=PRIVATE_FILE_CHUNK_BYTES){
        const slice=file.slice(offset,Math.min(offset+PRIVATE_FILE_CHUNK_BYTES,file.size));
        const data=toBase64(new Uint8Array(await slice.arrayBuffer()));
        if(!created){
          await fs.writeFile({...options(path),data});
          created=true;
        }else await fs.appendFile({...options(path),data});
        onProgress?.(Math.min(file.size,offset+slice.size),file.size);
        if(!file.size)break;
      }
      const saved=await fs.stat(options(path));
      if(Number.isFinite(saved?.size)&&saved.size!==file.size)
        throw new Error('檔案寫入大小驗證失敗；未加入本機清單。');
      await writeIndex([...before,entry]);
      return entry;
    }catch(error){
      if(created){try{await fs.deleteFile(options(path));}catch{/* Preserve the original error; orphan can be recovered manually. */}}
      throw error;
    }
  }

  async function remove(id){
    const path=privateFilePath(id);
    await ensureFilesFolder();
    const before=await readIndex();
    if(!before.some(item=>item.id===id))throw new Error('本機清單中找不到這份檔案。');
    // Delete content first. If it fails, the record still remains available for retry.
    await fs.deleteFile(options(path));
    await writeIndex(before.filter(item=>item.id!==id));
  }

  async function preview(id,encoding='auto'){
    privateFilePath(id);
    const entry=(await list()).find(item=>item.id===id);
    if(!entry)throw new Error('找不到本機檔案。');
    if(!isTextPrivateFile(entry))throw new Error('此格式不提供文字預覽，可以選擇「開啟／分享」交給 iOS。');
    if(entry.size>PRIVATE_PREVIEW_MAX_BYTES)throw new Error('超過 512 KB 的文字檔案請透過「開啟／分享」查看，避免 App 一次載入大量文字。');
    const bytes=await readBinary(entry);
    const effective=encoding==='auto'?(entry.detection?.encoding||'utf-8'):encoding;
    return new TextDecoder(effective,{fatal:false}).decode(bytes);
  }

  async function getUri(id){
    const path=privateFilePath(id);
    const entry=(await list()).find(item=>item.id===id);
    if(!entry)throw new Error('找不到本機檔案。');
    const result=await fs.getUri(options(path));
    if(typeof result?.uri!=='string'||!result.uri)throw new Error('無法取得 App 內的本機檔案 URI。');
    return result.uri;
  }

  return {list,importFile,readFile,remove,preview,getUri};
}
