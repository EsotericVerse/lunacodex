'use client';
import {useEffect,useState} from 'react';
import {mcpLocSession} from './mcp/loc-access.mjs';

const AUTHORITY='https://auth.lo3rwang.cc';
const DB_TYPES=[['direct','Direct SQL'],['supabase','Supabase API'],['neon','Neon API']];
const EMPTY={id:'',label:'',db_type:'direct',project_id:'',provider_oauth:'',engine:'',host:'',port:'',
 database:'',schema_name:'silver',table_name:'',field_map:'{}',
 ref_provider:'',ref_permission:'',
 username:'',password:'',auth_type:'default',domain:'',
 client_id:'',tenant_id:'',client_secret:'',token:'',
 selectable_by_users:false,allowed_subjects:''};
const ENGINES=[['postgres','PostgreSQL'],['mysql','MySQL / MariaDB'],
 ['mssql','SQL Server / Azure SQL']];
const AUTH_METHODS={
 postgres:[['default','PostgreSQL 帳號密碼']],
 mysql:[['default','MySQL 帳號密碼'],['ldap-simple','LDAP Simple（需 TLS）']],
 mssql:[['default','SQL Server 帳號密碼'],['ntlm','Windows NTLM'],
  ['azure-active-directory-default','Microsoft Entra Default Credential'],
  ['azure-active-directory-access-token','Microsoft Entra Access Token'],
  ['azure-active-directory-password','Microsoft Entra Username / Password'],
  ['azure-active-directory-msi-vm','Managed Identity（VM）'],
  ['azure-active-directory-msi-app-service','Managed Identity（App Service）'],
  ['azure-active-directory-service-principal-secret','Entra Service Principal']]
};
const PASSWORD_AUTH=new Set(['default','ldap-simple','ntlm',
 'azure-active-directory-password']);
const NEEDS_CLIENT_ID=new Set(['azure-active-directory-password',
 'azure-active-directory-service-principal-secret']);
function cleanForm(item){
 if(!item)return {...EMPTY};
 return {id:String(item.id||''),label:String(item.label||''),
  db_type:String(item.db_type||'direct'),project_id:String(item.project_id||''),
  provider_oauth:'',engine:String(item.engine||''),host:String(item.host||''),
  port:String(item.port??''),database:String(item.database||''),
  schema_name:String(item.schema_name|| (item.engine==='mssql'?'dbo':item.engine==='mysql'?'':'silver')),
  table_name:String(item.table_name||''),field_map:JSON.stringify(item.field_map||{},null,2),
  ref_provider:String(item.ref_provider||''),ref_permission:String(item.ref_permission||''),
  username:String(item.username||''),password:'',
  auth_type:String(item.authentication?.type||'default'),
  domain:String(item.authentication?.domain||''),
  client_id:String(item.authentication?.clientId||''),
  tenant_id:String(item.authentication?.tenantId||''),
  client_secret:'',token:'',
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
 if(result.status===429)return result.json();
 if(!result.ok)throw Error('LOC Auth 資料庫管理失敗（HTTP '+result.status+'）');
 return result.json();
}
export default function LocDatabaseAdmin(){
 const [root,setRoot]=useState(false);
 const [targets,setTargets]=useState([]);
 const [form,setForm]=useState(EMPTY);
 const [busy,setBusy]=useState(false);
 const [dirty,setDirty]=useState(false);
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
 const change=(key,value)=>{setDirty(true);setForm(previous=>({...previous,[key]:value}));};
 const editId=id=>{
  const selected=targets.find(t=>t.id===id);
  setForm(cleanForm(selected));setDirty(false);setStatus('');
 };
 const testConnection=async()=>{
  if(busy||dirty||!targets.some(t=>t.id===form.id))return;
  setBusy(true);setStatus('正在測試已儲存的 db_connection（只嘗試一次）…');
  try{
   const result=await authority('POST','/v1/targets/'+form.id+'/probe');
   const timestamp=result?.last_update?
    '；last_update：'+new Date(result.last_update).toLocaleString('zh-TW'):'';
   if(result?.verified===true)
    setStatus('db_connection 驗證成功：'+String(result.version||form.engine)+timestamp);
   else{
    const retry=Number(result?.retryAt||0);
    const wait=retry>Date.now()?'；'+Math.ceil((retry-Date.now())/60000)+' 分鐘後可再手動測試':'';
    setStatus('db_connection 未通過：'+String(result?.reason||'DATABASE_UNAVAILABLE')+wait+timestamp+'。已停止其他測試連線。');
   }
  }catch(error){setStatus('db_connection 測試未執行：'+String(error?.message||error));}
  finally{setBusy(false);}
 };
 const save=async event=>{
  event.preventDefault();
  if(busy)return;
  setBusy(true);setStatus('正在儲存連線設定…');
  try{
   if(!/^[a-z][a-z0-9_-]{0,63}$/.test(form.id))
    throw Error('請輸入符合規則的資料庫識別碼');
   if(!ENGINES.some(([value])=>value===form.engine))
    throw Error('請先明確選擇 SQL Type');
   if(!Number.isInteger(Number(form.port))||Number(form.port)<1||Number(form.port)>65535)
    throw Error('請輸入實際資料庫 Server Port');
   const allowed_subjects=form.allowed_subjects.split(/[\s,;]+/).filter(Boolean);
   const type=form.auth_type;
   const authentication={type,
    ...(type==='ntlm'?{domain:form.domain}:{}),
    ...(type.startsWith('azure-active-directory-')&&form.client_id
      ?{clientId:form.client_id}:{}),
    ...(type.startsWith('azure-active-directory-')&&form.tenant_id&&
       ['azure-active-directory-password',
        'azure-active-directory-service-principal-secret'].includes(type)
      ?{tenantId:form.tenant_id}:{}),
    ...(type==='azure-active-directory-service-principal-secret'&&form.client_secret
      ?{clientSecret:form.client_secret}:{}),
    ...(type==='azure-active-directory-access-token'&&form.token
      ?{token:form.token}:{})};
   let field_map;
   try{field_map=JSON.parse(form.field_map||'{}')}
   catch{throw Error('欄位映射必須是有效 JSON')}
   if(!field_map||typeof field_map!=='object'||Array.isArray(field_map))
     throw Error('欄位映射必須是欄位名稱的對照物件');
   const safe=/^[A-Za-z][A-Za-z0-9_]{0,119}$/;
   if(Object.entries(field_map).some(([logical,physical])=>
       !safe.test(logical)||typeof physical!=='string'||!safe.test(physical)))
     throw Error('欄位映射包含無效欄位');
   if(form.db_type!=='direct'&&form.engine!=='postgres')
     throw Error('此供應商僅支援指定 PostgreSQL SQL Type');
   if(form.db_type!=='direct'&&!/^[A-Za-z0-9_-]{1,80}$/.test(form.project_id))
     throw Error('請輸入供應商 Project ID');
   const payload={engine:form.engine,db_type:form.db_type,
    project_id:form.db_type==='direct'?'':form.project_id,
    ...(form.provider_oauth?{provider_oauth:form.provider_oauth}:{}),
    label:form.label||form.id,
    schema_name:form.schema_name,table_name:form.table_name,field_map,
    ref_provider:form.ref_provider,ref_permission:form.ref_permission,
    host:form.host,port:Number(form.port),database:form.database,
    username:form.username,authentication,
    selectable_by_users:form.selectable_by_users,allowed_subjects,
    ...(form.password?{password:form.password}:{})};
   await authority('PUT','/v1/targets/'+form.id,payload);
   const data=await authority('GET','/v1/state');
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id));
   setForm(previous=>({...previous,password:'',provider_oauth:'',client_secret:'',token:''}));
   setDirty(false);
   setStatus('連線設定已由 LOC Auth 加密儲存。Connection Secret 可獨立輪替，不影響 Target ID；不需要重新部署。');
  }catch(error){
   setStatus(String(error?.message||error));
  }finally{setBusy(false);}
 };
 return <section className="loc-card" aria-label="管理資料庫連線">
  <h2>管理可供使用者選擇的資料庫</h2>
  <p className="scope-status">只有 LOC 管理者能新增連線及開放選擇。Connection Secret 只傳往 LOC Auth 加密儲存，不會存於網站或 Git。</p>
  <p className="scope-status">所有 SQL Type 使用同一套 db_connection。儲存之後由管理者手動測試；失敗立即停止、五分鐘冷卻，不允許一般讀取觸發重試。</p>
  <p className="scope-status">建議定期檢視並主動輪替 Connection Secret；若疑似外洩，請立即更換並撤銷舊憑證。輪替只更改連線憑證，不會變更 Target ID、Project ID、SQL Type、Domain、Port 或原有 SSO 授權。輪替後應確認新連線成功，再停用舊憑證。</p>
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
   <label><span>資料庫供應商（db_type）</span>
    <select className="scope-select" value={form.db_type} disabled={busy}
     onChange={event=>{setDirty(true);setForm(previous=>({
       ...previous,db_type:event.target.value,
       project_id:'',provider_oauth:'',
       ...(event.target.value!=='direct'?{engine:'postgres'}:{})
     }));}}>
     {DB_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
   </label>
   {form.db_type!=='direct'?<>
    <label><span>供應商 Project ID</span>
     <input required value={form.project_id} disabled={busy}
      onChange={event=>change('project_id',event.target.value)}
      autoCapitalize="off" spellCheck={false}/></label>
    <label><span>供應商 API OAuth／Token（已儲存可留空）</span>
     <input type="password" value={form.provider_oauth} disabled={busy}
      onChange={event=>change('provider_oauth',event.target.value)}
      autoComplete="new-password"/></label>
   </>:null}
   <label><span>SQL Type（必須明確指定）</span>
    <select className="scope-select" required value={form.engine} disabled={busy}
     onChange={event=>{
       const engine=event.target.value;
       setDirty(true);
       setForm(prev=>({...prev,engine,auth_type:'default',domain:'',
        client_id:'',tenant_id:'',client_secret:'',token:'',
        port:'', // The SQL Server Port is specified, never guessed.
        schema_name:engine==='mssql'?'dbo':engine==='mysql'?'':'silver'}));
     }}>
     <option value="">請選擇 SQL Type</option>
     {ENGINES.filter(([key])=>form.db_type==='direct'||key==='postgres')
       .map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
   </label>
   <label><span>資料庫主機</span>
    <input required value={form.host} disabled={busy}
      onChange={event=>change('host',event.target.value)}
      placeholder="server.database.windows.net" autoCapitalize="off" spellCheck={false}/></label>
   <label><span>資料庫 Server Port（依實際配發，例如 6543）</span>
    <input required inputMode="numeric" value={form.port} disabled={busy}
      onChange={event=>change('port',event.target.value)}/></label>
   <label><span>資料庫名稱</span>
    <input required value={form.database} disabled={busy}
      onChange={event=>change('database',event.target.value)}/></label>
   <label><span>Schema（MySQL 留空，SQL Server 預設 dbo）</span>
    <input value={form.schema_name} disabled={busy}
      onChange={event=>change('schema_name',event.target.value)}
      placeholder={form.engine==='mssql'?'dbo':'silver'}/></label>
   <label><span>既有資料表（選填；指定後為唯讀映射）</span>
    <input value={form.table_name} disabled={busy}
      onChange={event=>change('table_name',event.target.value)}
      placeholder="existing_articles"/></label>
   <label className="scope-management-wide-field"><span>欄位映射（JSON；邏輯欄位 → 實際欄位）</span>
    <textarea rows={4} value={form.field_map} disabled={busy}
      spellCheck={false} onChange={event=>change('field_map',event.target.value)}
      placeholder={'{"uid":"external_id","title":"headline","content":"body","createtime":"created_at"}'}/>
   </label>
   <label><span>外部 Auth Ref（選填）</span>
    <select className="scope-select" value={form.ref_provider}
      onChange={event=>change('ref_provider',event.target.value)} disabled={busy}>
      <option value="">不要求外部 Auth Ref</option>
      <option value="github">GitHub</option>
      <option value="oidc">OIDC</option>
      <option value="entra">Microsoft Entra</option>
      <option value="ldap">LDAP（OIDC Bridge）</option>
      <option value="ad">Active Directory（OIDC Bridge）</option>
      <option value="clerk">Clerk JWT</option>
    </select>
   </label>
   <label><span>要求的外部權限 Claim（選填）</span>
    <input value={form.ref_permission} disabled={busy}
      onChange={event=>change('ref_permission',event.target.value)}
      placeholder="team-read"/></label>
   <label><span>資料庫登入方式</span>
    <select className="scope-select" value={form.auth_type} disabled={busy}
      onChange={event=>{setDirty(true);setForm(previous=>({...previous,auth_type:event.target.value,
        domain:'',client_id:'',tenant_id:'',client_secret:'',token:''}));}}>
     {(AUTH_METHODS[form.engine]||[]).map(([type,label])=>
       <option key={type} value={type}>{label}</option>)}
    </select>
   </label>
   <label><span>資料庫使用者</span>
    <input required={PASSWORD_AUTH.has(form.auth_type)}
      value={form.username} disabled={busy}
      onChange={event=>change('username',event.target.value)} autoComplete="off"/></label>
   <label><span>Connection Secret／資料庫密碼（可單獨輪替；留空則沿用既有值）</span>
    <input type="password" value={form.password} disabled={busy}
      onChange={event=>change('password',event.target.value)} autoComplete="new-password"/></label>
   {form.auth_type==='ntlm'?<label><span>Windows 網域（NTLM）</span>
    <input required value={form.domain} disabled={busy}
      onChange={event=>change('domain',event.target.value)} autoComplete="off"/>
   </label>:null}
   {form.auth_type.startsWith('azure-active-directory-')&&
    form.auth_type!=='azure-active-directory-access-token'?<label>
     <span>Entra Client ID（使用者指派 Identity 可選填）</span>
     <input required={NEEDS_CLIENT_ID.has(form.auth_type)}
      value={form.client_id} disabled={busy}
      onChange={event=>change('client_id',event.target.value)} autoComplete="off"/>
    </label>:null}
   {['azure-active-directory-password',
     'azure-active-directory-service-principal-secret'].includes(form.auth_type)
     ?<label><span>Entra Tenant ID（Service Principal 必填）</span>
      <input required={form.auth_type==='azure-active-directory-service-principal-secret'}
       value={form.tenant_id} disabled={busy}
       onChange={event=>change('tenant_id',event.target.value)} autoComplete="off"/>
     </label>:null}
   {form.auth_type==='azure-active-directory-service-principal-secret'?<label>
     <span>Entra Client Secret（已儲存可留空）</span>
     <input type="password" value={form.client_secret} disabled={busy}
      onChange={event=>change('client_secret',event.target.value)}
      autoComplete="new-password"/>
    </label>:null}
   {form.auth_type==='azure-active-directory-access-token'?<label>
     <span>Entra Access Token（已儲存可留空，須注意 Token 到期）</span>
     <input type="password" value={form.token} disabled={busy}
      onChange={event=>change('token',event.target.value)}
      autoComplete="new-password"/>
    </label>:null}
   <label className="scope-management-wide-field">
    <input type="checkbox" checked={form.selectable_by_users} disabled={busy}
      onChange={event=>change('selectable_by_users',event.target.checked)}/>
    允許所有已登入的 LOC 使用者選擇此資料庫
   </label>
   <label className="scope-management-wide-field"><span>另外允許的 LOC 使用者 ID（每行一個；可留空）</span>
    <textarea rows={3} value={form.allowed_subjects} disabled={busy}
      onChange={event=>change('allowed_subjects',event.target.value)} spellCheck={false}/>
   </label>
   <button type="button" className="loc-button" onClick={testConnection}
    disabled={busy||dirty||!targets.some(t=>t.id===form.id)}>
    單次測試 db_connection（每小時最多三次）
   </button>
   <button type="submit" className="loc-button primary" disabled={busy}>
    {busy?'儲存中…':'儲存資料庫連線與選擇權限'}
   </button>
  </form>
  {status?<p role="status" className="scope-status">{status}</p>:null}
 </section>;
}
