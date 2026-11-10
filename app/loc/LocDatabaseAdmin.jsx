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
const ENGINES=[['postgres','PostgreSQL']];
const AUTH_METHODS={postgres:[['default','PostgreSQL 帳號密碼']]};
const PASSWORD_AUTH=new Set(['default']);
function cleanForm(item){
 if(!item)return {...EMPTY};
 return {id:String(item.id||''),label:String(item.label||''),
  db_type:String(item.db_type||'direct'),project_id:String(item.project_id||''),
  provider_oauth:'',engine:String(item.engine||''),host:String(item.host||''),
  port:String(item.port??''),database:String(item.database||''),
  schema_name:String(item.schema_name||'silver'),
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
 if(!result.ok){
  // LOC Auth returns a bounded diagnostic message without SQL credentials.
  // Preserve the actual HTTP status instead of hiding every failure as 403.
  const detail=await result.json().catch(()=>null);
  const reason=typeof detail?.error==='string'&&detail.error.length<=160
   ?'：'+detail.error:'';
  const stage=typeof detail?.stage==='string'&&detail.stage.length<=32
   ?'（'+detail.stage+'）':'';
  throw Error('LOC Auth 資料庫管理失敗（HTTP '+result.status+'）'+reason+stage);
 }
 return result.json();
}
export default function LocDatabaseAdmin(){
 const [root,setRoot]=useState(false);
 const [targets,setTargets]=useState([]);
 const [primaryId,setPrimaryId]=useState('');
 const [form,setForm]=useState(EMPTY);
 const [busy,setBusy]=useState(false);
 const [dirty,setDirty]=useState(false);
 const [status,setStatus]=useState('');
 const [connectionUrl,setConnectionUrl]=useState('');
 const [showAdvanced,setShowAdvanced]=useState(false);
 useEffect(()=>{
  let active=true;
  authority('GET','/v1/state').then(data=>{
   if(!active)return;
   setRoot(true);
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id&&x.engine==='postgres'));
   setPrimaryId(String(data?.primary_id||''));
  }).catch(error=>{
   if(!active)return;
   // Never reveal the administrator form to non-root users, but do not
   // silently conceal a rejected or expired verified LOC session either.
   setStatus(String(error?.message||error));
  });
  return ()=>{active=false;};
 },[]);
 if(!root)return status?<p className="scope-status" role="status">{status}</p>:null;
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
 const makePrimary=async()=>{
  if(busy||dirty||!targets.some(t=>t.id===form.id))return;
  setBusy(true);setStatus('正在切換既有主要 db_connection…');
  try{
   await authority('POST','/v1/primary',{id:form.id});
   const data=await authority('GET','/v1/state');
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id&&x.engine==='postgres'));
   setPrimaryId(String(data?.primary_id||''));
   if(data?.primary_id!==form.id)throw Error('主要資料庫選擇未確認');
   setStatus('已選擇主要資料庫：'+form.id+'。讀寫仍須該連線通過手動 SQL 驗證。');
  }catch(error){setStatus('主要資料庫切換失敗：'+String(error?.message||error));}
  finally{setBusy(false);}
 };
 // First-time recovery of the existing main SQL connection. A single
 // provider-issued URI contains its *actual* SQL type, endpoint, port and
 // login; LOC never guesses these values or calls an SQL probe on save.
 const restoreMainFromUrl=async event=>{
  event.preventDefault();
  if(busy||targets.length)return;
  const source=connectionUrl.trim();
  setConnectionUrl(''); // Never retain SQL secrets in a long-lived form field.
  setBusy(true);
  setStatus('正在恢復既有主要資料庫的連線設定…');
  try{
   if(source.length>4096)throw Error('連線網址過長');
   let link;
   try{link=new URL(source)}catch{throw Error('連線網址格式不正確');}
   const engines={'postgres:':'postgres','postgresql:':'postgres'};
   const engine=engines[link.protocol];
   if(!engine||!link.hostname||!link.port)
    throw Error('請使用供應商 Connect 提供的 SQL 連線網址，並確認其中包含實際 Port');
   let username,password,database;
   try{
    username=decodeURIComponent(link.username);
    password=decodeURIComponent(link.password);
    database=decodeURIComponent(link.pathname.slice(1));
   }catch{throw Error('連線網址的帳號或資料庫名稱編碼無效');}
   if(!username||!password||!database)
    throw Error('連線網址尚缺資料庫使用者、密碼或資料庫名稱');
   if(!/^[a-z0-9.-]{1,253}$/i.test(link.hostname)||
     !/^[a-zA-Z0-9_-]{1,120}$/.test(database)||
     !Number.isInteger(Number(link.port))||Number(link.port)<1||Number(link.port)>65535)
    throw Error('連線網址含有無效的資料庫主機、Port 或資料庫名稱');
   const id='loc-main';
   await authority('PUT','/v1/targets/'+id,{
    label:'主要資料庫連線',engine,db_type:'direct',project_id:'',
    host:link.hostname,port:Number(link.port),database,
    schema_name:'silver',
    username,password,authentication:{type:'default'},
    table_name:'',field_map:{},ref_provider:'',ref_permission:'',
    selectable_by_users:false,allowed_subjects:[]
   });
   await authority('POST','/v1/primary',{id});
   const data=await authority('GET','/v1/state');
   if(data?.primary_id!==id)throw Error('主要資料庫設定尚未確認');
   const next=(data.targets||[]).filter(x=>x&&x.managed!==true&&x.id&&x.engine==='postgres');
   setTargets(next);
   setPrimaryId(id);
   setForm(cleanForm(next.find(x=>x.id===id)));
   setDirty(false);
   setStatus('主要資料庫連線已加密儲存並選定；尚需由本人手動驗證一次 SQL，才會啟用正式讀寫。');
  }catch(error){
   setStatus('主要資料庫恢復未完成：'+String(error?.message||error));
  }finally{setBusy(false);}
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
   const authentication={type:'default'};
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
   setTargets((data?.targets||[]).filter(x=>x&&x.managed!==true&&x.id&&x.engine==='postgres'));
   setPrimaryId(String(data?.primary_id||''));
   setForm(previous=>({...previous,password:'',provider_oauth:'',client_secret:'',token:''}));
   setDirty(false);
   setStatus('連線設定已由 LOC Auth 加密儲存。Connection Secret 可獨立輪替，不影響 Target ID；不需要重新部署。');
  }catch(error){
   setStatus(String(error?.message||error));
  }finally{setBusy(false);}
 };
 return <section className="loc-card" aria-label="管理資料庫連線">
  <h2>管理可供使用者選擇的資料庫</h2>
  <p className="scope-status">已選主要資料庫：{primaryId||'尚未設定'}。連線密碼只傳至 LOC Auth 加密儲存；不存於網站或 Git，儲存不觸發 SQL 測試。</p>
  {targets.length===0?<section className="scope-management-wide-field">
   <h3>恢復既有主要資料庫</h3>
   <p className="scope-status">LOC Auth 尚未有已儲存的主要資料庫 Profile。不需重建資料庫、選擇 SQL Type 或逐欄猜測 Host、Port；直接使用既有供應商 Connect 頁提供的完整 SQL Connection URL。</p>
   <form className="scope-management-fields" onSubmit={restoreMainFromUrl} autoComplete="off">
    <label className="scope-management-wide-field"><span>既有資料庫的 SQL Connection URL（須含實際 Port 及密碼）</span>
     <input required type="password" value={connectionUrl} disabled={busy}
      onChange={event=>setConnectionUrl(event.target.value)}
      autoComplete="off" spellCheck={false} placeholder="postgresql://…@…:實際Port/資料庫名稱"/>
    </label>
    <button type="submit" className="loc-button primary" disabled={busy||!connectionUrl.trim()}>
     {busy?'儲存中…':'加密儲存並設為主要資料庫（不測試 SQL）'}
    </button>
   </form>
   <button type="button" className="loc-button" disabled={busy}
    onClick={()=>setShowAdvanced(value=>!value)}>
    {showAdvanced?'收起進階連線設定':'展開進階連線設定'}
   </button>
  </section>:null}
  {(targets.length>0||showAdvanced)?<>
  <p className="scope-status">進階連線設定：僅在新增其他 SQL 來源或修改現有 Profile 時使用。SQL 驗證由管理者手動啟動，失敗後遵守來源冷卻。</p>
  <p className="scope-status">需要時可主動輪替 Connection Secret；若疑似外洩，請立即更換並撤銷舊憑證。輪替只變更連線密碼，不會變更 Target ID、Project ID、SQL Type、Domain、Port 或 LOC SSO 授權。</p>
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
      placeholder="postgres_test" autoCapitalize="off" spellCheck={false}/></label>
   <label><span>顯示名稱</span>
    <input maxLength={120} value={form.label} disabled={busy}
      onChange={event=>change('label',event.target.value)}
      placeholder="PostgreSQL 測試資料庫"/></label>
   <label><span>資料庫供應商（db_type）</span>
    <select className="scope-select" value={form.db_type} disabled={busy}
     onChange={event=>{setDirty(true);setForm(previous=>({
       ...previous,db_type:event.target.value,
       project_id:'',provider_oauth:'',
       engine:'' // SQL Type must be chosen by the user, never inferred.
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
        port:'', // Port comes from the selected SQL connection.
        schema_name:'silver'}));
     }}>
     <option value="">請選擇 SQL Type</option>
     {ENGINES.filter(([key])=>form.db_type==='direct'||key==='postgres')
       .map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
   </label>
   <label><span>資料庫主機</span>
    <input required value={form.host} disabled={busy}
      onChange={event=>change('host',event.target.value)}
      placeholder="database.example.net" autoCapitalize="off" spellCheck={false}/></label>
   <label><span>資料庫 Server Port（依實際配發，例如 6543）</span>
    <input required inputMode="numeric" value={form.port} disabled={busy}
      onChange={event=>change('port',event.target.value)}/></label>
   <label><span>資料庫名稱</span>
    <input required value={form.database} disabled={busy}
      onChange={event=>change('database',event.target.value)}/></label>
   <label><span>Schema（PostgreSQL）</span>
    <input value={form.schema_name} disabled={busy}
      onChange={event=>change('schema_name',event.target.value)}
      placeholder="silver"/></label>
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
   <label className="scope-management-wide-field">
    <input type="checkbox" checked={form.selectable_by_users} disabled={busy}
      onChange={event=>change('selectable_by_users',event.target.checked)}/>
    允許所有已登入的 LOC 使用者選擇此資料庫
   </label>
   <label className="scope-management-wide-field"><span>另外允許的 LOC 使用者 ID（每行一個；可留空）</span>
    <textarea rows={3} value={form.allowed_subjects} disabled={busy}
      onChange={event=>change('allowed_subjects',event.target.value)} spellCheck={false}/>
   </label>
   <button type="button" className="loc-button" onClick={makePrimary}
    disabled={busy||dirty||!targets.some(t=>t.id===form.id)||primaryId===form.id}>
    {primaryId===form.id?'目前主要資料庫':'設為主要資料庫（不觸發 SQL 測試）'}
   </button>
   <button type="button" className="loc-button" onClick={testConnection}
    disabled={busy||dirty||!targets.some(t=>t.id===form.id)}>
    單次測試 db_connection（每小時最多三次）
   </button>
   <button type="submit" className="loc-button primary" disabled={busy}>
    {busy?'儲存中…':'儲存資料庫連線與選擇權限'}
   </button>
  </form>
  </>:null}
  {status?<p role="status" className="scope-status">{status}</p>:null}
 </section>;
}
