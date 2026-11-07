'use client';
import {useEffect,useState} from 'react';
import {mcpLocSession} from './mcp/loc-access.mjs';

const AUTHORITY='https://auth.lo3rwang.cc';
const EMPTY={id:'',label:'',engine:'postgres',host:'',port:'5432',
 database:'',username:'',password:'',selectable_by_users:false,
 allowed_subjects:''};
const ENGINES=[['postgres','PostgreSQL'],['mysql','MySQL / MariaDB'],
 ['mssql','SQL Server / Azure SQL']];
function cleanForm(item){
 if(!item)return {...EMPTY};
 return {id:String(item.id||''),label:String(item.label||''),
  engine:String(item.engine||'postgres'),host:String(item.host||''),
  port:String(item.port||'5432'),database:String(item.database||''),
  username:String(item.username||''),password:'',
  selectable_by_users:item.selectable_by_users===true,
  allowed_subjects:Array.isArray(item.allowed_subjects)?
    item.allowed_subjects.join('\n'):''};
}
async function authority(method,path,payload){
 const {token}=await mcpLocSession();
 const result=await fetch(AUTHORITY+path,{
  method,credentials:'omit',cache:'no-store',redirect:'error',
  headers:{authorization:'Bearer '+token,accept:'application/json',
   ...(payload?{'content-type':'application/json'}:{})},
  ...(payload?{body:JSON.stringify(payload)}:{}),
  signal:AbortSignal.timeout(12000)
 });
 if(!result.ok)throw Error('LOC Auth 資料庫管理失敗（HTTP '+result.status+'）');
 return result.json();
}
export default function LocDatabaseAdmin(){
 const [root,setRoot]=useState(false);
 const [targets,setTargets]=useState([]);
 const [form,setForm]=useState(EMPTY);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 useEffect(()=>{
  let active=true;
  authority('GET','/v1/state').then(data=>{
   if(!active)return;
   setRoot(true);
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id));
  }).catch(error=>{
   if(!active)return;
   // Non-root users never receive the administrator form or connection metadata.
   if(!/HTTP 403/.test(String(error.message)))setStatus(String(error.message));
  });
  return ()=>{active=false;};
 },[]);
 if(!root)return null;
 const change=(key,value)=>setForm(previous=>({...previous,[key]:value}));
 const editId=id=>{
  const selected=targets.find(t=>t.id===id);
  setForm(cleanForm(selected));setStatus('');
 };
 const save=async event=>{
  event.preventDefault();
  if(busy)return;
  setBusy(true);setStatus('正在儲存連線設定…');
  try{
   if(!/^[a-z][a-z0-9_-]{0,63}$/.test(form.id))
    throw Error('請輸入符合規則的資料庫識別碼');
   const allowed_subjects=form.allowed_subjects.split(/[\s,;]+/).filter(Boolean);
   const payload={engine:form.engine,label:form.label||form.id,
    host:form.host,port:Number(form.port),database:form.database,
    username:form.username,selectable_by_users:form.selectable_by_users,
    allowed_subjects,
    ...(form.password?{password:form.password}:{})};
   await authority('PUT','/v1/targets/'+form.id,payload);
   const data=await authority('GET','/v1/state');
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id));
   setForm(previous=>({...previous,password:''}));
   setStatus('連線設定已由 LOC Auth 加密儲存。使用者可立即選擇；不需要重新部署。');
  }catch(error){
   setStatus(String(error?.message||error));
  }finally{setBusy(false);}
 };
 return <section className="loc-card" aria-label="管理資料庫連線">
  <h2>管理可供使用者選擇的資料庫</h2>
  <p className="scope-status">只有 LOC 管理者能新增連線及開放選擇。資料庫密碼只傳往 LOC Auth 加密儲存，不會存於網站或 Git。</p>
  <label><span>編輯既有連線</span>
   <select className="scope-select" value={targets.some(x=>x.id===form.id)?form.id:''}
    onChange={event=>editId(event.target.value)} disabled={busy}>
    <option value="">新增資料庫連線</option>
    {targets.map(item=><option key={item.id} value={item.id}>
      {item.label||item.id}（{item.engine}）
    </option>)}
   </select>
  </label>
  <form className="scope-management-fields" onSubmit={save} autoComplete="off">
   <label><span>資料庫識別碼</span>
    <input required maxLength={64} value={form.id} disabled={busy}
      onChange={event=>change('id',event.target.value)}
      placeholder="azure_sql_test" autoCapitalize="off" spellCheck={false}/></label>
   <label><span>顯示名稱</span>
    <input maxLength={120} value={form.label} disabled={busy}
      onChange={event=>change('label',event.target.value)}
      placeholder="Azure SQL 測試資料庫"/></label>
   <label><span>SQL 種類</span>
    <select className="scope-select" value={form.engine} disabled={busy}
     onChange={event=>{
       const engine=event.target.value;
       setForm(prev=>({...prev,engine,port:engine==='mssql'?'1433':
        engine==='mysql'?'3306':'5432'}));
     }}>
     {ENGINES.map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
   </label>
   <label><span>資料庫主機</span>
    <input required value={form.host} disabled={busy}
      onChange={event=>change('host',event.target.value)}
      placeholder="server.database.windows.net" autoCapitalize="off" spellCheck={false}/></label>
   <label><span>連接埠</span>
    <input required inputMode="numeric" value={form.port} disabled={busy}
      onChange={event=>change('port',event.target.value)}/></label>
   <label><span>資料庫名稱</span>
    <input required value={form.database} disabled={busy}
      onChange={event=>change('database',event.target.value)}/></label>
   <label><span>資料庫使用者</span>
    <input required value={form.username} disabled={busy}
      onChange={event=>change('username',event.target.value)} autoComplete="off"/></label>
   <label><span>資料庫密碼（修改既有連線可留空）</span>
    <input type="password" value={form.password} disabled={busy}
      onChange={event=>change('password',event.target.value)} autoComplete="new-password"/></label>
   <label className="scope-management-wide-field">
    <input type="checkbox" checked={form.selectable_by_users} disabled={busy}
      onChange={event=>change('selectable_by_users',event.target.checked)}/>
    允許所有已登入的 LOC 使用者選擇此資料庫
   </label>
   <label className="scope-management-wide-field"><span>另外允許的 LOC 使用者 ID（每行一個；可留空）</span>
    <textarea rows={3} value={form.allowed_subjects} disabled={busy}
      onChange={event=>change('allowed_subjects',event.target.value)} spellCheck={false}/>
   </label>
   <button type="submit" className="loc-button primary" disabled={busy}>
    {busy?'儲存中…':'儲存資料庫連線與選擇權限'}
   </button>
  </form>
  {status?<p role="status" className="scope-status">{status}</p>:null}
 </section>;
}
