'use client';
import {useEffect,useState} from 'react';
import {mcpLocSession} from './mcp/loc-access.mjs';
import LocDatabaseAdmin from './LocDatabaseAdmin';

const AUTHORITY='https://auth.lo3rwang.cc';
const ENGINES={postgres:'PostgreSQL'};
const AUTH_REFS={github:'GitHub',oidc:'OIDC',entra:'Microsoft Entra',
 ldap:'LDAP（OIDC Bridge）',ad:'Active Directory（OIDC Bridge）',clerk:'Clerk JWT'};
async function requestDatabase(method,path,body){
 const {token}=await mcpLocSession();
 const response=await fetch(AUTHORITY+path,{
  method,credentials:'omit',cache:'no-store',redirect:'error',
  headers:{authorization:'Bearer '+token,accept:'application/json',
   ...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('資料庫選擇無法使用（HTTP '+response.status+'）');
 return response.json();
}
export default function LocDatabaseSwitcher(){
 const [choices,setChoices]=useState([]);
 const [selected,setSelected]=useState('configured');
 const [loading,setLoading]=useState(true);
 const [switching,setSwitching]=useState(false);
 const [status,setStatus]=useState('');
 const [externalProof,setExternalProof]=useState('');
 const [authRefBusy,setAuthRefBusy]=useState(false);
 useEffect(()=>{
  let mounted=true;
  requestDatabase('GET','/v1/databases')
   .then(data=>{
    if(!mounted)return;
    const rows=Array.isArray(data?.targets)?data.targets.filter(t=>
      /^[a-z][a-z0-9_-]{0,63}$/.test(String(t?.id||''))&&
      Object.hasOwn(ENGINES,t?.engine)):[];
    setChoices(rows);
    setSelected(rows.some(x=>x.id===data?.selected)?data.selected:'configured');
   }).catch(error=>{if(mounted)setStatus(String(error.message||error));})
   .finally(()=>{if(mounted)setLoading(false);});
  return ()=>{mounted=false};
 },[]);
 const selectedTarget=choices.find(choice=>choice.id===selected);
 function startExternalRef(){
   const provider=selectedTarget?.ref_provider;
   if(!provider||provider==='clerk'||!Object.hasOwn(AUTH_REFS,provider))return;
   const target=new URL('/oauth/ref',AUTHORITY);
   target.searchParams.set('provider',provider);
   target.searchParams.set('return_to','/local/settings/');
   window.location.assign(target.href);
 }
 async function submitClerkRef(event){
   event.preventDefault();
   if(!selectedTarget||selectedTarget.ref_provider!=='clerk'||!externalProof.trim()||authRefBusy)return;
   setAuthRefBusy(true);setStatus('正在參照外部身分…');
   try{
     const result=await requestDatabase('POST','/v1/auth/ref/check',{
       provider:'clerk',credential:externalProof.trim()});
     if(result?.provider!=='clerk')throw Error('LOC Auth 未確認外部參照');
     setExternalProof('');setStatus('外部身分已核驗。LOC 身分與權限不會被取代。');
   }catch(error){setStatus(String(error.message||error))}
   finally{setAuthRefBusy(false)}
 }
 async function select(event){
  const id=event.target.value;
  if(switching||(!choices.some(x=>x.id===id)&&id!=='configured'))return;
  setSwitching(true);setStatus('切換資料庫中…');
  try{
   const result=await requestDatabase('POST','/v1/databases/selection',{id});
   if((result?.selected||'configured')!==id)
    throw Error('LOC Auth 未確認資料庫選擇');
   // Recreate the in-memory SQL adapters and their signed-token caches.
   // No site build, Gateway restart or SQL migration occurs.
   window.location.reload();
  }catch(error){
   setStatus(String(error?.message||error));setSwitching(false);
  }
 }
 return <section className="loc-card" aria-label="資料庫切換">
  <h2>使用的資料庫</h2>
  <p className="scope-status">選擇已授權的資料庫，LOC 會即時使用對應的 PostgreSQL 連線，不需要重新部署。</p>
  {loading?<p role="status">正在取得可使用的資料庫…</p>:
   <label><span>資料庫連線</span>
    <select className="scope-select" value={selected}
      onChange={select} disabled={switching||loading}>
     <option value="configured">主要資料庫（預設）</option>
     {choices.map(item=><option key={item.id} value={item.id}>
      {item.label}（{ENGINES[item.engine]}）
     </option>)}
    </select>
   </label>}
  {switching||status?<p className="scope-status" role="status">{status}</p>:null}
  {selectedTarget?.ref_provider?<section className="scope-management-wide-field">
    <h3>外部授權參照（可選；僅此資料庫要求）</h3>
    <p className="scope-status">目前資料來源要求 {AUTH_REFS[selectedTarget.ref_provider]||selectedTarget.ref_provider}
      {selectedTarget.ref_permission?' · '+selectedTarget.ref_permission:''}。
      LOC Auth 保留原生登入與 Session；外部來源只證明其自身的授權。</p>
    {selectedTarget.ref_provider==='clerk'?
      <form onSubmit={submitClerkRef}>
        <label><span>Clerk 已簽署 JWT（不會儲存原始 Token）</span>
          <input type="password" value={externalProof} autoComplete="off"
            onChange={event=>setExternalProof(event.target.value)}
            disabled={authRefBusy} maxLength={12288}/>
        </label>
        <button type="submit" className="loc-button" disabled={!externalProof.trim()||authRefBusy}>
          核驗外部身分</button>
      </form>:
      <button type="button" className="loc-button" onClick={startExternalRef}>
        向 {AUTH_REFS[selectedTarget.ref_provider]} 參照授權
      </button>}
   </section>:null}
  <LocDatabaseAdmin/>
 </section>;
}
