'use client';

import {useMemo,useState} from 'react';
import {dbAuthClient} from './db-client.mjs';
import {useAccount} from './use-account';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';

const FIELDS=Object.freeze([
  ['statics','統計'],['culture','文化'],['search','搜尋'],['trace','痕跡'],
  ['list','文章列表'],['keyword','關鍵詞'],['extract','搜尋片段'],['others','其他']
]);
const EMPTY=()=>Object.fromEntries(FIELDS.map(([key])=>[key,'keep']));
export default function BulkGalaxyVisibility({scopeId}){
  const account=useAccount();
  const dock=useEditDock();
  const permitted=Boolean(account.user&&dock?.active&&dock.scopeId===scopeId&&account.canManageScopeSync(scopeId));
  const [site,setSite]=useState('mcp');
  const [fields,setFields]=useState(EMPTY);
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [progress,setProgress]=useState(0);
  const patch=useMemo(()=>Object.fromEntries(FIELDS.filter(([key])=>fields[key]!=='keep')
    .map(([key])=>[key,fields[key]==='true'])),[fields]);
  const signature=JSON.stringify([scopeId,site.trim().toLowerCase(),patch]);
  const dirty=Object.keys(patch).length>0;
  const privateSource=['mcp','github'].includes(site.trim().toLowerCase());
  const reset=()=>{setSite('mcp');setFields(EMPTY());setPreview(null);setStatus('');setProgress(0);};
  function changedSource(value){setSite(value);setPreview(null);setStatus('');}
  function changedField(key,value){setFields(previous=>({...previous,[key]:value}));setPreview(null);setStatus('');}
  const perform=async args=>{
    const {data,error}=await dbAuthClient.schema('silver').managedAction('bulk_update_galaxy_able',args);
    if(error)throw Error(error.message||'大量更新權限或資料庫操作失敗');
    const result=data?.data&&typeof data.data==='object'?data.data:data;
    if(!result||typeof result!=='object'||!Number.isInteger(Number(result.matching)))
      throw Error('無效的大量更新回應');
    return result;
  };
  async function inspect(){
    if(!permitted||busy||!dirty)return;
    setBusy(true);setPreview(null);setProgress(0);
    try{
      const result=await perform({p_scope_id:scopeId,p_site:site.trim().toLowerCase(),
        p_flags:patch,p_apply:false});
      setPreview({signature,count:Number(result.matching)||0});
      setStatus('已預覽 '+Number(result.matching||0).toLocaleString()+' 筆需要更新；只修改勾選的 Boolean 欄位。');
    }catch(e){setStatus(String(e.message||e));}
    finally{setBusy(false);}
  }
  async function save(){
    if(!permitted||busy||!dirty||!preview||preview.signature!==signature)return false;
    let remaining=preview.count,completed=0;
    if(!remaining){setStatus('沒有需要更新的紀錄。');return true;}
    setBusy(true);setStatus('正在按批次更新 Galaxy 權限旗標…');
    try{
      for(let i=0;i<10000&&remaining>0;i++){
        const result=await perform({p_scope_id:scopeId,p_site:site.trim().toLowerCase(),
          p_flags:patch,p_apply:true,p_expected_count:remaining,p_batch_size:250});
        const updated=Number(result.updated)||0;
        if(updated<=0||updated>remaining)throw Error('批次沒有進度；已中斷以避免重複處理');
        completed+=updated;remaining=Number(result.remaining)||0;
        setProgress(completed);
      }
      if(remaining)throw Error('超出安全批次上限');
      setFields(EMPTY());setPreview(null);
      setStatus('已完成 '+completed.toLocaleString()+' 筆；只更改指定旗標，UID、正文、來源不變。');
      return true;
    }catch(e){
      setPreview(null);
      setStatus('已更新 '+completed.toLocaleString()+' 筆；其餘未完成。請重新預覽後續做：'+String(e.message||e));
      return false;
    }finally{setBusy(false);}
  }
  const activateEditor=useEditDockForm({save,isDirty:()=>dirty,isBusy:()=>busy,discard:reset});
  if(!permitted)return null;
  return <section className="loc-card scope-feature-card" aria-label="Galaxy 八項權限大量更新"
    onFocusCapture={activateEditor} onPointerDownCapture={activateEditor}>
    <h2>Galaxy 八項權限・大量更新</h2>
    <p className="scope-status">先指定來源與欄位，預覽後使用上方編輯工具列的「儲存」執行；不逐篇輸入 UID。MCP 文字與 GitHub 開發紀錄只能設為停用。</p>
    <label htmlFor="bulk-galaxy-site">文章來源（site）</label>
    <input id="bulk-galaxy-site" value={site} maxLength={64} autoComplete="off"
      onChange={event=>changedSource(event.target.value)} disabled={busy} placeholder="mcp / github / facebook"/>
    <div className="scope-tabs">
      <button type="button" disabled={busy} onClick={()=>{
        setFields(Object.fromEntries(FIELDS.map(([key])=>[key,'false'])));
        setPreview(null);setStatus('');
      }}>全部設為停用</button>
      <button type="button" disabled={busy} onClick={()=>{setFields(EMPTY());setPreview(null);setStatus('');}}>
        清除欄位選擇
      </button>
    </div>
    <div className="scope-management-records">
      {FIELDS.map(([key,label])=><label key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <span>{label} <small>({key})</small></span>
        <select aria-label={label} value={fields[key]} disabled={busy}
          onChange={event=>changedField(key,event.target.value)}>
          <option value="keep">不修改</option>
          <option value="false">停用（false）</option>
          <option value="true" disabled={privateSource}>啟用（true）</option>
        </select>
      </label>)}
    </div>
    <button type="button" className="loc-button" disabled={!dirty||busy}
      onClick={inspect}>{busy?'正在處理…':'預覽待更新筆數'}</button>
    {preview&&preview.signature===signature?<p className="scope-status">待更新：{preview.count.toLocaleString()} 筆。請使用編輯工具列儲存，執行每批 250 筆更新。</p>:null}
    {progress>0?<p className="scope-status">完成進度：{progress.toLocaleString()} 筆</p>:null}
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </section>;
}
