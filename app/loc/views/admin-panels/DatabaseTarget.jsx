'use client';
import {useEffect,useState} from 'react';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {resolveDatabaseRouting} from '../../providers/routing-config.mjs';
import {dbAuthClient} from '../../db-client.mjs';
import {readonlyAuthStatus,recoveryOAuthLabel} from '../../providers/auth-status-readonly.mjs';

const FILE_URL='https://github.com/EsotericVerse/moon-runes-pwa/edit/main/app/loc/providers/access.js';
const ACCESS_FILE='app/loc/providers/access.js';
const routing=resolveDatabaseRouting();

export default function DatabaseTarget(){
  const [backupHealth,setBackupHealth]=useState({state:'idle'});
  const [recoveryOAuth,setRecoveryOAuth]=useState('讀取中…');
  const [authOverview]=useState(readonlyAuthStatus);
  useEffect(()=>{
    let active=true;
    fetch('/recovery/config.json',{cache:'no-store'})
      .then(response=>{if(!response.ok)throw Error('No recovery config');return response.json();})
      .then(config=>{if(active)setRecoveryOAuth(recoveryOAuthLabel(config));})
      .catch(()=>{if(active)setRecoveryOAuth('未設定／無法讀取');});
    if(!DATABASE_ACCESS_LIST.some(item=>item.backup_selected===true)){
      setBackupHealth({state:'absent'});
    }else{
      setBackupHealth({state:'checking'});
      dbAuthClient.schema('silver').managedAction('check_backup_readiness')
        .then(({data,error})=>{
          if(!active)return;
          setBackupHealth(error?{state:'offline'}:data?.online
            ?{state:data.schema?'online':'schema-error'}:{state:'offline'});
        }).catch(()=>{if(active)setBackupHealth({state:'offline'});});
    }
    return()=>{active=false;};
  },[]);
  const ready=DATABASE_ACCESS_LIST;
  return <section className="loc-card admin-workspace">
    <h2>資料庫連線與部署設定</h2>
    <p className="scope-status">資料庫目標由 <code>{ACCESS_FILE}</code> 決定。這是部署設定，不讀寫
      <code>api.manage.database</code>。修改 JS 並提交 GitHub 後，重新部署才會生效；此頁不提供假的即時儲存。</p>
    <p className="scope-status">主要：{ready.find(item=>item.target_id===routing.primaryId)?.label||routing.primaryId}
      ｜備援：{ready.find(item=>item.target_id===routing.backupId)?.label||'未啟用'}</p>
    <div className="scope-management-fields">
      {ready.map(item=><section className="scope-management-wide-field" key={item.target_id}>
        <h3 className="admin-workspace-section-heading">{item.label} · {item.target_id}</h3>
        <p className="scope-status">類型：{item.engine} / {item.provider}
          ｜{item.target_id===routing.primaryId?'主要資料庫':item.backup_selected?'備援資料庫':'未啟用'}</p>
        <p className="scope-status">連線 Alias：<code>{item.connection_alias}</code></p>
        <p className="scope-status">Project ID／Endpoint：<code>{item.project_id||item.project_url||'依伺服器設定'}</code></p>
      </section>)}
    </div>
    <p className="scope-status">連線密碼、Token、含密碼的 Database URL 不得寫入 JS；仍由 Edge Secrets／Vault 提供。
      存取此設定檔並不等於取得資料庫讀寫權限。</p>
    <p><a className="loc-button" href={FILE_URL} target="_blank" rel="noopener noreferrer">
      在 GitHub 編輯 access.js
    </a></p>
    <p className="scope-status" role="status">備援：
      {backupHealth.state==='absent'?'未設定':
        backupHealth.state==='checking'?'檢查中…':
        backupHealth.state==='online'?'連線與必要表正常':
        backupHealth.state==='schema-error'?'連線正常，但必要表不完整':'連線或驗證失敗'}
    </p>
    <div className="scope-management-wide-field" aria-label="OAuth 與 Auth 狀態（唯讀）">
      <h3 className="admin-workspace-section-heading">身分來源與 LOC 授權（唯讀）</h3>
      <p className="scope-status">目前網站登入：{authOverview.primaryOAuth}</p>
      <p className="scope-status">授權服務：{authOverview.authorization}</p>
      <p className="scope-status">資料庫連線不使用託管商的 Auth；登入來源不改變 SQL 授權與 Kysely 操作。</p>
      <p className="scope-status">過渡期 Clerk 設定：{recoveryOAuth}</p>
    </div>
  </section>;
}
