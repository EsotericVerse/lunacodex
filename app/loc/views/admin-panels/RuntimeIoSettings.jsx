'use client';

import {useEffect,useRef,useState} from 'react';
import {IO_LIMIT_CEILINGS,applyRuntimeIoLimits,normalizeRuntimeIoLimits} from '../../query/query-batch-size.mjs';
import {readLocRuntimeConfig,saveLocRuntimeConfig} from '../../runtime/runtime-config.mjs';
import {useEditDockForm} from '../../../modular/edit-dock';
import {cachedRead,invalidateCachedRead} from '../../db/semi-dynamic-cache.mjs';

const RUNTIME_IO_CACHE_KEY='admin-runtime-io:loc';

const FIELDS=[
  {key:'archiveMiB',label:'備份檔案上限',unit:'MiB',min:1},
  {key:'jsonMiB',label:'JSON 檔案上限',unit:'MiB',min:1},
  {key:'documentMiB',label:'文件檔案上限',unit:'MiB',min:1},
  {key:'timelineMiB',label:'Timeline 檔案上限',unit:'MiB',min:1}
];
const fromRow=row=>Object.fromEntries(FIELDS.map(({key})=>[key,
  Number(row?.io_limits?.[key]??IO_LIMIT_CEILINGS[key])]));

export default function RuntimeIoSettings(){
  const [draft,setDraft]=useState(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const initial=useRef('');
  useEffect(()=>{
    let active=true;
    cachedRead(RUNTIME_IO_CACHE_KEY,()=>readLocRuntimeConfig()).then(row=>{
      if(!active)return;
      const values=fromRow(row);initial.current=JSON.stringify(values);setDraft(values);
    }).catch(error=>{if(active)setNotice(String(error?.message||error));});
    return()=>{active=false;};
  },[]);
  const changed=Boolean(draft&&JSON.stringify(draft)!==initial.current);
  const save=async()=>{
    if(!draft||busy)return false;
    setBusy(true);setNotice('');
    try{
      const settings=normalizeRuntimeIoLimits(draft);
      const saved=await saveLocRuntimeConfig({io_limits:settings});
      invalidateCachedRead(RUNTIME_IO_CACHE_KEY);
      const next=fromRow(saved);
      applyRuntimeIoLimits(next);
      initial.current=JSON.stringify(next);setDraft(next);
      setNotice('系統設定已儲存並讀回確認。');
      return true;
    }catch(error){setNotice(String(error?.message||error));return false;}
    finally{setBusy(false);}
  };
  // Initial config loading is not a save transaction.
  useEditDockForm({save,isDirty:()=>changed,isBusy:()=>busy});
  return <section className="loc-card scope-feature-card" aria-label="系統設定">
    <h3>系統設定</h3>
    {draft?<div className="scope-management-fields">
      {FIELDS.map(field=><label key={field.key}>{field.label}（{field.unit}）
        <input type="number" min={field.min} max={IO_LIMIT_CEILINGS[field.key]} step="1"
          disabled={busy} value={draft[field.key]}
          onChange={event=>setDraft(current=>({...current,[field.key]:event.target.value}))}/>
      </label>)}
    </div>:<p className="scope-status" role="status">正在讀取系統設定…</p>}
    {notice?<p role="status" className="scope-status">{notice}</p>:null}
  </section>;
}
