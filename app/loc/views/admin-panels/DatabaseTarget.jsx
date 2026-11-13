'use client';
import {useEffect,useState} from 'react';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {resolveDatabaseRouting} from '../../providers/routing-config.mjs';
import {dbAuthClient} from '../../db-client.mjs';

const FILE_URL='https://github.com/EsotericVerse/moon-runes-pwa/edit/main/app/loc/providers/access.js';
const ACCESS_FILE='app/loc/providers/access.js';
const routing=resolveDatabaseRouting();

export default function DatabaseTarget(){
  const [backupHealth,setBackupHealth]=useState({state:'idle'});
  useEffect(()=>{
    let active=true;
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
    <p className="scope-status">本頁僅顯示預設控制資料庫連線；每位使用者的資料庫選擇由 LOC Auth
      即時管理，切換 PostgreSQL／MySQL／SQL Server 無需重新部署，亦不讀寫
      <code>api.manage.database</code>。</p>
    <p className="scope-status">主要：{ready.find(item=>item.target_id===routing.primaryId)?.label||routing.primaryId}
      ｜備援：{ready.find(item=>item.target_id===routing.backupId)?.label||'未啟用'}</p>
    <div className="scope-management-fields">
      {ready.map(item=><section className="scope-management-wide-field" key={item.target_id}>
        <h3 className="admin-workspace-section-heading">{item.label} · {item.target_id}</h3>
        <p className="scope-status">類型：{item.engine} / {item.provider}
          ｜{item.target_id===routing.primaryId?'主要資料庫':item.backup_selected?'備援資料庫':'未啟用'}</p>
        <p className="scope-status">連線 Alias：<code>{item.connection_alias}</code></p>
        <p className="scope-status">連線位置與密碼僅在 LOC Auth 與受信任的應用後端管理，不傳送給瀏覽器。</p>
      </section>)}
    </div>
    <p className="scope-status">連線密碼、Token 與資料庫 URL 由 LOC Auth 及受信任的應用後端保管。
      預設連線 Alias 不提供資料庫存取權限。</p>
    <p><a className="loc-button" href={FILE_URL} target="_blank" rel="noopener noreferrer">
      在 GitHub 查看預設 access.js
    </a></p>
    <p className="scope-status" role="status">備援：
      {backupHealth.state==='absent'?'未設定':
        backupHealth.state==='checking'?'檢查中…':
        backupHealth.state==='online'?'連線與必要表正常':
        backupHealth.state==='schema-error'?'連線正常，但必要表不完整':'連線或驗證失敗'}
    </p>
  </section>;
}
