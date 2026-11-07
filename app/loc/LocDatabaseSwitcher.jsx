'use client';
import {useEffect,useState} from 'react';
import {mcpLocSession} from './mcp/loc-access.mjs';

const AUTHORITY='https://auth.lo3rwang.cc';
const ENGINES={postgres:'PostgreSQL',mysql:'MySQL / MariaDB',
 mssql:'SQL Server / Azure SQL'};
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
  <p className="scope-status">選擇已授權的資料庫，LOC 會即時使用對應的 PostgreSQL、MySQL 或 SQL Server 連線，不需要重新部署。</p>
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
 </section>;
}
