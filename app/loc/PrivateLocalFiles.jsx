'use client';
import {useFeatureCopy,useUiLocale} from '../i18n/ui-locale';
import featureZh from '../i18n/feature-sections/privateFiles.zh_tw.js';

import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {createPrivateLocalStore,isTextPrivateFile,privateFilePath} from './private-local-files.mjs';

const byteLabel=(size,l)=>{
  if(!Number.isFinite(size))return l.unknownSize;
  if(size<1024)return size+' B';
  if(size<1024*1024)return (size/1024).toFixed(1)+' KB';
  return (size/(1024*1024)).toFixed(1)+' MB';
};
const privateNative=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios';
const readableDate=(value,locale,l)=>value?new Date(value).toLocaleString(locale):l.unknownDate;

export default function PrivateLocalFiles(){
  const l=useFeatureCopy('privateFiles',featureZh);
  const {locale}=useUiLocale();
  const picker=useRef(null);
  const [native,setNative]=useState(false);
  const [store,setStore]=useState(null);
  const [entries,setEntries]=useState([]);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [progress,setProgress]=useState(null);
  const [pendingDelete,setPendingDelete]=useState('');
  const [preview,setPreview]=useState(null);
  const [encoding,setEncoding]=useState('auto');

  useEffect(()=>{
    const supported=privateNative();
    setNative(supported);
    if(!supported)return;
    let active=true;
    (async()=>{
      try{
        const {Filesystem,Directory}=await import('@capacitor/filesystem');
        if(!Directory.LibraryNoCloud)throw new Error(l.unsupportedStorage);
        const storage=createPrivateLocalStore(Filesystem,Directory.LibraryNoCloud);
        const files=await storage.list();
        if(active){setStore(storage);setEntries(files);}
      }catch(e){if(active)setError(l.startupFailed+String(e?.message||e));}
    })();
    return()=>{active=false;};
  },[l]);

  if(!native)return null;

  async function chooseFiles(event){
    const files=Array.from(event.target.files||[]);
    event.target.value='';
    if(!files.length||busy||!store)return;
    setBusy(true);setError('');setStatus('');setProgress(null);setPreview(null);setPendingDelete('');
    let completed=0;
    const failures=[];
    try{
      for(const file of files){
        try{
          await store.importFile(file,(written,total)=>setProgress({
            name:file.name,written,total,completed,count:files.length
          }));
          completed++;
        }catch(e){failures.push(file.name+'：'+String(e?.message||e));}
      }
      setEntries(await store.list());
      window.dispatchEvent(new CustomEvent('loc-private-file-changed'));
      setStatus(l.savedPrefix+completed+' / '+files.length+l.savedMiddle);
      if(failures.length)setError(failures.join('; '));
    }catch(e){setError(l.fileListFailed+String(e?.message||e));}
    finally{setProgress(null);setBusy(false);}
  }

  async function showText(entry,nextEncoding='auto'){
    if(busy||!store)return;
    setBusy(true);setStatus('');setError('');
    try{
      const text=await store.preview(entry.id,nextEncoding);
      setEncoding(nextEncoding);
      setPreview({id:entry.id,name:entry.name,text});
    }catch(e){setPreview(null);setError(l.previewFailed+String(e?.message||e));}
    finally{setBusy(false);}
  }

  async function openWithIOS(entry){
    if(busy||!store)return;
    setBusy(true);setError('');setStatus('');setPreview(null);
    let copyPath='';
    try{
      const [{Filesystem,Directory},{Share}]=await Promise.all([
        import('@capacitor/filesystem'),import('@capacitor/share')
      ]);
      const base='loc-private-file-share';
      const cleanName=entry.name.replace(/[\\/\u0000-\u001f:]/g,'_').slice(0,180)||'private-file';
      copyPath=base+'/'+entry.id+'/'+cleanName;
      await Filesystem.mkdir({path:base+'/'+entry.id,directory:Directory.Cache,recursive:true});
      await Filesystem.copy({
        from:privateFilePath(entry.id),directory:Directory.LibraryNoCloud,
        to:copyPath,toDirectory:Directory.Cache
      });
      const {uri}=await Filesystem.getUri({path:copyPath,directory:Directory.Cache});
      if(!uri)throw new Error(l.shareUnavailable);
      await Share.share({title:entry.name,url:uri,dialogTitle:l.shareTitle});
      setStatus(l.shareSuccess);
    }catch(e){setError(l.shareFailed+String(e?.message||e));}
    finally{
      if(copyPath){
        try{
          const {Filesystem,Directory}=await import('@capacitor/filesystem');
          await Filesystem.deleteFile({path:copyPath,directory:Directory.Cache});
        }catch{/* Temporary cache may be cleared by iOS. */}
      }
      setBusy(false);
    }
  }

  async function remove(entry){
    if(busy||!store)return;
    if(pendingDelete!==entry.id){setPendingDelete(entry.id);setPreview(null);return;}
    setBusy(true);setError('');setStatus('');
    try{
      await store.remove(entry.id);
      setEntries(await store.list());
      window.dispatchEvent(new CustomEvent('loc-private-file-changed'));
      setPendingDelete('');
      setPreview(null);
      setStatus(l.deletePrefix+entry.name+l.deleteSuffix);
    }catch(e){setError(l.deleteFailed+String(e?.message||e));}
    finally{setBusy(false);}
  }

  return <section className="loc-card" aria-labelledby="loc-private-files-heading">
    <h2 id="loc-private-files-heading">{l.title}</h2>
    <p className="scope-settings-note">{l.disclaimer}</p>
    <div className="scope-stat-controls">
      <button type="button" className="loc-button primary" onClick={()=>picker.current?.click()} disabled={busy||!store}>{l.import}</button>
      <button type="button" className="loc-button" onClick={async()=>{
        if(busy||!store)return;
        setBusy(true);setError('');
        try{setEntries(await store.list());setStatus(l.refreshSuccess);}
        catch(e){setError(l.refreshFailed+String(e?.message||e));}
        finally{setBusy(false);}
      }} disabled={busy||!store}>{l.refresh}</button>
      <input ref={picker} hidden type="file" multiple onChange={chooseFiles} aria-label={l.fileInput}/>
    </div>
    {!store&&!error?<p className="scope-settings-note" role="status">{l.opening}</p>:null}
    {progress?<p role="status" className="scope-settings-note">{l.saving}{progress.name}: {byteLabel(progress.written,l)} / {byteLabel(progress.total,l)}{l.completed}{progress.completed} / {progress.count}{l.fileUnit}</p>:null}
    {status?<p role="status" className="scope-status">{status}</p>:null}
    {error?<p role="alert" className="scope-status scope-error">{error}</p>:null}
    <h3>{l.savedCount}{entries.length}）</h3>
    {store&&!entries.length?<p className="scope-settings-note">{l.empty}</p>:null}
    {entries.map(entry=><div key={entry.id} className="scope-inline-card">
      <strong style={{overflowWrap:'anywhere'}}>{entry.name}</strong>
      <p className="scope-settings-note">{byteLabel(entry.size,l)}{l.importDate}{readableDate(entry.importedAt,locale,l)}{entry.lastModified?l.modifiedDate+readableDate(entry.lastModified,locale,l):''}</p>
      {entry.detection?<p className="scope-settings-note">{l.recognition}{entry.detection.label} ({entry.detection.certainty==='high'?l.high:entry.detection.certainty==='medium'?l.medium:l.unconfirmed}){entry.detection.encoding?l.suggestedEncoding+entry.detection.encoding:''}. {entry.detection.reason}</p>:<p className="scope-settings-note">{l.legacy}</p>}
      <div className="scope-stat-controls">
        {isTextPrivateFile(entry)?<button type="button" className="loc-button" onClick={()=>showText(entry)} disabled={busy}>{l.preview}</button>:null}
        <button type="button" className="loc-button" onClick={()=>openWithIOS(entry)} disabled={busy}>{l.openShare}</button>
        <button type="button" className="loc-button" disabled={busy} onClick={()=>remove(entry)}>
          {pendingDelete===entry.id?l.deleteConfirm:l.deleteCopy}
        </button>
        {pendingDelete===entry.id?<button type="button" className="loc-button" onClick={()=>setPendingDelete('')} disabled={busy}>{l.cancel}</button>:null}
      </div>
      {preview?.id===entry.id?<div>
        <label>{l.encoding}
          <select className="scope-select" value={encoding} onChange={event=>{
            const value=event.target.value;
            setEncoding(value);
            showText(entry,value);
          }} disabled={busy}>
            <option value="auto">{l.autoEncoding}</option>
            <option value="utf-8">UTF-8</option>
            <option value="big5">{l.big5}</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
          </select>
        </label>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'24rem',overflowY:'auto'}}>{preview.text}</pre>
        <button type="button" className="loc-button" onClick={()=>setPreview(null)}>{l.closePreview}</button>
      </div>:null}
    </div>)}
  </section>;
}
