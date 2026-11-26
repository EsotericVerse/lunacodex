'use client';
import {useEffect,useState} from 'react';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {resolveDatabaseRouting} from '../../providers/routing/config.mjs';
import {readBackupReadiness,readHyperdriveMode,setHyperdriveMode,
  readContainerMode,setContainerMode}
  from '../../actions/admin/queries.mjs';

const routing=resolveDatabaseRouting();

export default function DatabaseTarget(){
  const [backupHealth,setBackupHealth]=useState({state:'idle'});
  const [hyperdrive,setHyperdrive]=useState({state:'loading',enabled:true});
  const [modeMessage,setModeMessage]=useState('');
  const [savingMode,setSavingMode]=useState(false);
  const [container,setContainer]=useState(null);
  const [containerBusy,setContainerBusy]=useState(false);
  const [containerMessage,setContainerMessage]=useState('');
  useEffect(()=>{
    let active=true;
    readContainerMode().then(data=>{if(active)setContainer(data);})
      .catch(()=>{if(active)setContainerMessage('Container 設定讀取失敗。');});
    return()=>{active=false;};
  },[]);
  const changeContainer=async enabled=>{
    setContainerBusy(true);setContainerMessage('');
    try{setContainer(await setContainerMode(enabled));}
    catch(error){setContainerMessage(error?.message||'Container 設定未變更。');}
    finally{setContainerBusy(false);}
  };
  useEffect(()=>{
    let active=true;
    if(!DATABASE_ACCESS_LIST.some(item=>item.backup_selected===true)){
      setBackupHealth({state:'absent'});
    }else{
      setBackupHealth({state:'checking'});
      readBackupReadiness()
        .then(data=>{
          if(!active)return;
          setBackupHealth(data?.online
            ?{state:data.schema?'online':'schema-error'}:{state:'offline'});
        }).catch(()=>{if(active)setBackupHealth({state:'offline'});});
    }
    readHyperdriveMode().then(data=>{
      if(!active)return;
      setHyperdrive({state:'ready',enabled:data?.enabled!==false,
        connectionMode:data?.connectionMode||'direct'});
    }).catch(()=>{
      if(!active)return;
      setHyperdrive({state:'error',enabled:true});
      setModeMessage('HyperDrive 模式讀取失敗。');
    });
    return()=>{active=false;};
  },[]);
  const changeHyperdriveMode=async enabled=>{
    setSavingMode(true);
    setModeMessage(enabled?'正在驗證 HyperDrive 連線…':'正在驗證 LOC_DATABASE_URI 直連…');
    try{
      const result=await setHyperdriveMode(enabled);
      setHyperdrive({state:'ready',enabled:result?.enabled===true,
        connectionMode:result?.connectionMode||'direct'});
      setModeMessage(enabled?'HyperDrive 已啟用。':
        'HyperDrive 已關閉，LOC 使用 LOC_DATABASE_URI 直連。');
    }catch(error){
      setModeMessage(error?.message||'連線預檢失敗，模式未變更。');
    }finally{setSavingMode(false);}
  };
  const ready=DATABASE_ACCESS_LIST;
  return <section className="loc-card admin-workspace">
    <h2>資料庫連線與運算</h2>
    <section className="scope-management-wide-field">
      <label>
        <input type="checkbox" role="switch" aria-label="開啟 HyperDrive 模式"
          checked={hyperdrive.enabled} disabled={hyperdrive.state!=='ready'||savingMode}
          onChange={event=>{void changeHyperdriveMode(event.currentTarget.checked);}} />
        {' '}開啟 HyperDrive 模式
      </label>
      <p className="scope-status">開啟後使用 HyperDrive；關閉後改用資料庫直連。查詢快取維持關閉。</p>
      <p className="scope-status">{modeMessage||(
        hyperdrive.state==='loading'?'正在讀取模式…':
        hyperdrive.state==='error'?'模式未確認。':
        '目前使用：'+(hyperdrive.connectionMode==='hyperdrive'?'HyperDrive':'資料庫直連'))}</p>
      <p className="scope-status">切換前會先確認連線；失敗時設定不變。</p>
    </section>
    <section className="scope-management-wide-field">
      <label><input type="checkbox" role="switch" aria-label="啟用 Container 運算"
        checked={container?.enabled===true&&container?.available===true}
        disabled={!container?.available||containerBusy}
        onChange={event=>void changeContainer(event.currentTarget.checked)}/>
        {' '}啟用 Container 運算</label>
      <p className="scope-status">大量關鍵詞解析與匯入可使用 Container；無法使用時會由 LOC 處理。</p>
      <p className="scope-status" role="status">{containerMessage||
        (!container?'讀取設定中…':!container.available?'Container 未綁定':
          container.enabled?'已啟用（按需運算）':'已停用')}</p>
    </section>
    <p className="scope-status">主要：{ready.find(item=>item.target_id===routing.primaryId)?.label||routing.primaryId}
      ｜備援：{ready.find(item=>item.target_id===routing.backupId)?.label||'未啟用'}</p>
    <div className="scope-management-fields">
      {ready.map(item=><section className="scope-management-wide-field" key={item.target_id}>
        <h3 className="admin-workspace-section-heading">{item.label} · {item.target_id}</h3>
        <p className="scope-status">類型：{item.engine} / {item.provider}
          ｜{item.target_id===routing.primaryId?'主要資料庫':item.backup_selected?'備援資料庫':'未啟用'}</p>
      </section>)}
    </div>
    <p className="scope-status" role="status">備援：
      {backupHealth.state==='absent'?'未設定':
        backupHealth.state==='checking'?'檢查中…':
        backupHealth.state==='online'?'連線與必要表正常':
        backupHealth.state==='schema-error'?'連線正常，但必要表不完整':'連線或驗證失敗'}
    </p>
  </section>;
}
