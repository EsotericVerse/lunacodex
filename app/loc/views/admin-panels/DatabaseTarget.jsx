'use client';
import {useEffect,useRef,useState} from 'react';
import Select from 'react-select';
import UiText from '../../../i18n/UiText';
import FieldText from '../../../i18n/FieldText';
import {registerDefaultSection} from '../../../i18n/ui-copy';
import {useUiSection} from '../../../i18n/ui-locale';
import adminViewZh from '../../../i18n/sections/uiExtra.adminView.zh_tw.js';
import {SQL_ENGINE_OPTIONS} from '../../providers/sql-engine-ports.mjs';
import {databaseProviderChoices,normalizeDatabaseLocation} from '../../providers/database-link.mjs';
import {dbAuthClient} from '../../db-client.mjs';
import {resolveDatabaseRouting} from '../../providers/routing-config.mjs';
import {preferredDatabasePrimary} from '../../providers/emergency-primary.mjs';
import {readonlyAuthStatus,recoveryOAuthLabel} from '../../providers/auth-status-readonly.mjs';
import {useEditDockForm} from '../../../modular/edit-dock';
registerDefaultSection('uiExtra.adminView',adminViewZh);
const STATIC_ROUTING=resolveDatabaseRouting();

function AuthStatusLight({label,enabled}){
  return <span role="status" aria-label={label+'：'+(enabled?'已配置支援':'尚未配置')}>
    <span aria-hidden="true" style={{color:enabled?'#198754':'#c53030',marginRight:6}}>●</span>
    {label}：{enabled?'已配置支援':'尚未配置'}
  </span>;
}

export default function DatabaseTarget(){
  useUiSection('uiExtra.adminView');
  const [rows,setRows]=useState([]);
  const [selectedId,setSelectedId]=useState('');
  const [status,setStatus]=useState('');
  const [revision,setRevision]=useState(0);
  const [saving,setSaving]=useState(false);
  // Transient credentials are not stored in LOC metadata or browser storage.
  const [connectionUrl,setConnectionUrl]=useState('');
  const [controlToken,setControlToken]=useState('');
  const [authType,setAuthType]=useState('default');
  const [authDomain,setAuthDomain]=useState('');
  const [backupHealth,setBackupHealth]=useState({state:'idle'});
  const [authOverview,setAuthOverview]=useState(()=>readonlyAuthStatus({
    identityProvider:process.env.NEXT_PUBLIC_LOC_IDENTITY_PROVIDER||'',
    neonAuthUrl:process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL||'',
    neonDataApiUrl:process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL||''
  }));
  const [recoveryOAuth,setRecoveryOAuth]=useState('讀取中…');
  const original=useRef({rows:[]});
  useEffect(()=>{
    // No provider probe or OAuth sign-in. This only reads local routing and public recovery metadata.
    setAuthOverview(readonlyAuthStatus({
      primaryId:preferredDatabasePrimary(),
      identityProvider:process.env.NEXT_PUBLIC_LOC_IDENTITY_PROVIDER||'',
    neonAuthUrl:process.env.NEXT_PUBLIC_LOC_NEON_AUTH_URL||'',
      neonDataApiUrl:process.env.NEXT_PUBLIC_LOC_NEON_DATA_API_URL||''
    }));
    let active=true;
    fetch('/recovery/config.json',{cache:'no-store'})
      .then(response=>{if(!response.ok)throw Error('No recovery config');return response.json();})
      .then(config=>{if(active)setRecoveryOAuth(recoveryOAuthLabel(config));})
      .catch(()=>{if(active)setRecoveryOAuth('未設定／無法讀取');});
    return()=>{active=false};
  },[]);
  useEffect(()=>{
    let active=true;
    (async()=>{
      const {data,error}=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',
        {p_section:'database',p_operation:'read'});
      if(!active)return;
      if(error){setStatus(error.message||'資料庫目標讀取失敗。');return;}
      const next=(data||[]).sort((a,b)=>String(a.provider).localeCompare(String(b.provider))||String(a.target_id).localeCompare(String(b.target_id)));
      original.current={rows:next};
      setRows(next);
      setSelectedId(current=>next.some(item=>item.target_id===current)?current:
        (next.find(item=>item.target_id===STATIC_ROUTING.primaryId)?.target_id||next[0]?.target_id||''));
      const backup=next.find(item=>item.backup_selected);
      if(!backup)setBackupHealth({state:'absent'});
      else {
        setBackupHealth({state:'checking'});
        try{
          const {data:health,error:healthError}=await dbAuthClient.schema('silver').managedAction('check_backup_readiness');
          if(active)setBackupHealth(healthError?{state:'offline'}:health?.online
            ?{state:health.schema?'online':'schema-error'}:{state:'offline'});
        }catch{if(active)setBackupHealth({state:'offline'});}
      }
    })();
    return()=>{active=false};
  },[revision]);
  const configuredBackup=rows.find(item=>item.backup_selected===true)||null;
  const index=rows.findIndex(item=>item.target_id===selectedId);
  const row=index<0?null:rows[index];
  const isManaged=row?.target_id==='supabase-current'||row?.target_id==='neon-current';
  const protectedTarget=Boolean(row&&(row.target_id===STATIC_ROUTING.primaryId||
    row.selected||row.backup_selected));
  const patch=(key,value)=>setRows(current=>current.map(item=>item.target_id===selectedId?{...item,[key]:value}:item));
  const savedRow=item=>original.current.rows.find(saved=>saved.target_id===item.target_id);
  const rowDirty=item=>Boolean(item&&JSON.stringify(item)!==JSON.stringify(savedRow(item)));
  const discardCurrent=()=>{
    if(!rowDirty(row))return true;
    if(!window.confirm('目前資料庫有尚未儲存的修改，確定放棄嗎？'))return false;
    setRows(current=>row._new?current.filter(item=>item.target_id!==selectedId):
      current.map(item=>item.target_id===selectedId?savedRow(item)||item:item));
    return true;
  };
  const pick=id=>{
    if(id===selectedId||saving)return;
    if(!discardCurrent())return;
    setSelectedId(id);setStatus('');
    setConnectionUrl('');setControlToken('');setAuthType('default');setAuthDomain('');
  };
  const add=()=>{
    if(saving||!discardCurrent())return;
    const id='target_'+crypto.randomUUID().replaceAll('-','').slice(0,20);
    setRows(current=>[...current,{target_id:id,provider:'custom',engine:'postgres',connection_alias:id,connection_mode:'direct',label:'新資料庫',project_id:'',project_url:'',region:'',selected:false,_new:true}]);
    setSelectedId(id);setStatus('');
    setConnectionUrl('');setControlToken('');setAuthType('default');setAuthDomain('');
  };
  async function remove(){
    if(!row||saving)return;
    if(protectedTarget){setStatus('主要或備援資料庫不可在仍被系統使用時刪除。');return;}
    if(!window.confirm('確定刪除資料庫「'+(row.label||row.target_id)+'」？'))return;
    if(row._new){
      setRows(current=>current.filter(item=>item.target_id!==row.target_id));
      setSelectedId(rows.find(item=>item.target_id!==row.target_id)?.target_id||'');
      setStatus('已取消新增資料庫。');
      return;
    }
    setSaving(true);setStatus('');
    try{
      const {data,error}=await dbAuthClient.schema('silver').managedAction('loc_admin_settings',
        {p_section:'database',p_operation:'delete',p_key:row.target_id});
      if(error||data?.some(item=>item.target_id===row.target_id))
        throw new Error(error?.message||'刪除資料庫目標失敗，未確認刪除。');
      setStatus('已刪除資料庫目標。');setRevision(v=>v+1);
    }catch(error){setStatus(error?.message||'刪除失敗。');}
    finally{setSaving(false);}
  }
  async function save(){
    if(!row||saving)return false;
    if(!rowDirty(row)&&!connectionUrl&&!controlToken)return true;
    setSaving(true);setStatus('');
    try{
      const name=String(row.label||'').trim();
      if(!name||name.length>120)throw new Error('請輸入 1–120 字的資料庫名稱。');
      const previous=savedRow(row);
      const inputHost=row.project_url||(
        connectionUrl?new URL(connectionUrl).host:'');
      const location=!row._new&&previous?.project_url===inputHost&&previous?.provider===row.provider
        ?{link:inputHost}
        :normalizeDatabaseLocation(row.provider,inputHost);
      // Only non-sensitive target metadata belongs here. The former
      // save_database_target endpoint is absent; admin RLS secures writes.
      const payload={
        engine:row.provider==='custom'?row.engine:'postgres',
        provider:row.provider,
        connection_alias:row.connection_alias,
        connection_mode:row.provider==='supabase'?(row.connection_mode||'pooler'):row.connection_mode,
        label:name,
        project_id:location.projectId||row.project_id||null,
        project_url:location.link,
        region:row.region||'',
        updated_at:new Date().toISOString()
      };
      if(Boolean(connectionUrl)!==Boolean(controlToken))
        throw new Error('請同時提供資料庫完整 URL 與 Control Token。');
      const action=connectionUrl&&controlToken?'connect_database_target':'loc_admin_settings';
      const args=action==='connect_database_target'
        ?{p_target:{...payload,target_id:row.target_id,connection_url:connectionUrl,
          control_token:controlToken,auth_type:authType,domain:authDomain,activate:true}}
        :{p_section:'database',p_operation:'upsert',p_key:row.target_id,p_value:payload};
      const {data,error}=await dbAuthClient.schema('silver').managedAction(action,args);
      if(error||(action==='connect_database_target'
        ?data?.target_id!==row.target_id
        :!data?.some(item=>item.target_id===row.target_id)))
        throw new Error(error?.message||'資料庫連線未完成，原設定維持不變。');
      setControlToken('');setConnectionUrl('');
      setStatus('資料庫設定已儲存。');
      setRevision(v=>v+1);
      return true;
    }catch(error){setStatus(error?.message||'儲存失敗，原目標維持不變。');return false;}
    finally{setSaving(false);}
  }
  const changedRows=rows.filter(item=>JSON.stringify(item)!==JSON.stringify(original.current.rows.find(saved=>saved.target_id===item.target_id)));
  useEditDockForm({
    isBusy:()=>saving,
    isDirty:()=>changedRows.length>0||Boolean(connectionUrl||controlToken),
    save:async()=>{
      if(changedRows.some(item=>item.target_id!==selectedId)){
        setStatus('其他資料庫仍有未儲存資料，請逐筆儲存後再切換分區。');
        return false;
      }
      return save();
    }
  });
  return <section className="loc-card admin-workspace">
    <h2><UiText id="uiExtra.adminView.databaseRouting"/></h2>
    <p className="scope-status">主要：{rows.find(item=>item.selected)?.label||STATIC_ROUTING.primaryId}｜備援資料庫：{configuredBackup?.label||'未設定（選配）'}</p>
    <p className="scope-status" role="status">
      {backupHealth.state==='absent'?'備援：未設定（選配，不需檢查）':
        backupHealth.state==='idle'||backupHealth.state==='checking'
          ?'備援連線與必要資料表：檢查中…'
          :<><span aria-label={backupHealth.state==='online'?'正常':'異常'} style={{
            color:backupHealth.state==='online'?'#198754':'#c53030',marginRight:6
          }}>●</span>{backupHealth.state==='online'?'備援連線與必要資料表正常':
            backupHealth.state==='schema-error'?'備援已連線，但必要資料表不完整':
            '備援連線或驗證失敗（不影響主要資料庫）'}</>}
      {backupHealth.state!=='absent'?<button type="button" className="loc-button"
        disabled={saving} onClick={()=>setRevision(value=>value+1)}>重新檢查</button>:null}
    </p>
    {/* Authentication status: display only, no credentials or control actions. */}
    <div className="scope-management-wide-field" aria-label="OAuth 與 Auth 狀態（唯讀）">
      <h3 className="admin-workspace-section-heading">OAuth 來源（唯讀）</h3>
      <p className="scope-status">LOC 登入：{authOverview.primaryOAuth}</p>
      <p className="scope-status">Clerk 環境：{recoveryOAuth}</p>
      <div className="scope-status" style={{display:'flex',gap:16,flexWrap:'wrap'}}>
        <AuthStatusLight label="Supabase Auth" enabled={authOverview.supabaseSupported}/>
        <AuthStatusLight label="Neon Auth" enabled={authOverview.neonSupported}/>
      </div>
      <p className="scope-status">燈號只表示程式有對應 Auth 支援且必要設定已提供，不代表服務在線、已啟用或已通過實際登入。此處不能編輯認證，也不會修改 Database Link 或切換路由。</p>
    </div>
    <h3><UiText id="uiExtra.adminView.savedDatabaseConnections"/></h3>
    <div className="admin-inline-select">
      <div>
        <label htmlFor="admin-database-target-select"><UiText id="uiExtra.adminView.savedDatabases"/></label>
        <Select
          inputId="admin-database-target-select"
          instanceId="admin-database-target-select"
          unstyled
          className="loc-settings-select"
          classNamePrefix="loc-settings-select"
          isSearchable={rows.length>5}
          isClearable={false}
          isDisabled={saving}
          options={rows.map(item=>({value:item.target_id,label:item.label||item.target_id}))}
          value={rows.map(item=>({value:item.target_id,label:item.label||item.target_id})).find(option=>option.value===selectedId)||null}
          onChange={option=>{if(option)pick(option.value);}}
        />
      </div>
      <button type="button" className="loc-button" disabled={saving} onClick={add}><UiText id="uiExtra.adminView.addDatabase"/></button>
    </div>
    {row?<div className="scope-management-fields">
      <h3 className="admin-workspace-section-heading"><UiText id="uiExtra.adminView.connectionDetails"/></h3>
      <label><span><UiText id="uiExtra.adminView.databaseName"/></span>
        <input value={row.label||''} maxLength={120} onChange={event=>patch('label',event.target.value)}/></label>
      <label><span><UiText id="uiExtra.adminView.databaseType"/></span><select className="admin-native-select" value={row.engine||'postgres'} disabled={isManaged} onChange={event=>{
        const engine=event.target.value;
        setRows(current=>current.map(item=>item.target_id===selectedId?{...item,engine,provider:engine==='postgres'?item.provider:'custom',connection_mode:'direct'}:item));
      }}>
        {SQL_ENGINE_OPTIONS.map(option=><option key={option.value} value={option.value} disabled={option.value==='sqlite'}>{option.label}{option.value==='sqlite'?'（需本機／Gateway）':''}</option>)}
      </select></label>
      <label><span><UiText id="uiExtra.adminView.provider"/></span><select className="admin-native-select" value={row.provider} disabled={isManaged} onChange={event=>patch('provider',event.target.value)}>
        {databaseProviderChoices(row.engine).map(option=><option key={option.value} value={option.value}><FieldText text={option.label}/></option>)}
      </select></label>
      <label><span><UiText id="uiExtra.adminView.databaseEndpoint"/></span><input value={row.project_url||''} onChange={event=>patch('project_url',event.target.value)}
        placeholder={row.provider==='supabase'?'Project ID 或 https://xxx.supabase.co':row.provider==='neon'?'Neon DB Endpoint 或 Data API URL':'db.example.com:5432'}/></label>
      <label><span><UiText id="uiExtra.adminView.regionArea"/></span><input value={row.region||''} onChange={event=>patch('region',event.target.value)} placeholder="例如 ap-southeast-1、eastus"/></label>
      {row.provider==='custom'?<div className="scope-management-wide-field" style={{display:'grid',gap:8}}>
        <label>SQL 連線 URL（僅安全連線時使用）
          <input value={connectionUrl} autoComplete="off" spellCheck={false}
            onChange={event=>setConnectionUrl(event.target.value)}
            placeholder={row.engine==='mssql'
              ?'mssql://user@server:1433/database'
              :row.engine==='mysql'
                ?'mysql://user@server:3306/database'
                :'postgresql://user@server:5432/database'}/>
        </label>
        <label>SQL Driver 認證
          <select className="admin-native-select" value={authType}
            onChange={event=>setAuthType(event.target.value)}>
            <option value="default">資料庫密碼／Token</option>
            {row.engine==='mysql'?<option value="ldap-simple">MySQL LDAP Simple（TLS）</option>:null}
            {row.engine==='mssql'?<>
              <option value="ntlm">SQL Server NTLM／AD</option>
              <option value="azure-active-directory-access-token">Microsoft Entra Access Token</option>
              <option value="azure-active-directory-default">Microsoft Entra Default Credential</option>
            </>:null}
          </select>
        </label>
        {authType==='ntlm'?<label>Windows／AD 網域
          <input value={authDomain} autoComplete="off"
            onChange={event=>setAuthDomain(event.target.value)} placeholder="CORP"/>
        </label>:null}
        <label>Database Control Token／Password
          <input type="password" value={controlToken} autoComplete="new-password"
            onChange={event=>setControlToken(event.target.value)}
            placeholder="只傳送至 LOC SQL Gateway"/>
        </label>
        <p className="scope-status">儲存前以 Kysely 實際連線檢查；成功後立即切換主要資料庫。憑證僅存受保護的伺服器 Vault。</p>
      </div>:null}
      <div className="scope-management-wide-field">
        <button type="button" className="loc-button" onClick={remove} disabled={saving||protectedTarget}
          title={protectedTarget?'主要或備援資料庫使用中，不可刪除':undefined}><UiText id="uiExtra.adminView.delete"/></button>
      </div>
    </div>:null}
    <p className="scope-status">只需要一個主要資料庫。輸入 SQL 連線 URL 和 Control Token 後，由可信任 Gateway 驗證並儲存於 Vault；成功的連線可直接成為主要資料來源。備援資料庫為選配。</p>
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </section>;
}
