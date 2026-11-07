'use client';

import {useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {selectAllRows} from '../loc/db-query.mjs';
import {exportRuneSQLite,importRuneSQLite,inspectRuneSQLite,listLocalRuneDraws} from './local-rune-sqlite.mjs';

const FILE_TYPE='application/vnd.sqlite3';
const ACCEPT='.sqlite,.sqlite3,.db,application/vnd.sqlite3';
const EXT=/\.(?:sqlite|sqlite3|db)$/i;

function todayInTaipei(){
  return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
}
async function shareSQLite(bytes,filename){
  if(Capacitor.isNativePlatform()){
    // Native bridge makes an actual local binary file, then presents the iOS
    // Files/share sheet. It never posts the bytes to an HTTP endpoint.
    const [{Filesystem,Directory},{Share}]=await Promise.all([
      import('@capacitor/filesystem'),import('@capacitor/share')
    ]);
    let raw='';
    for(let offset=0;offset<bytes.length;offset+=8192)
      raw+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    await Filesystem.writeFile({
      path:filename,data:btoa(raw),directory:Directory.Cache
    });
    const {uri}=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    if(!uri)throw new Error('原生 SQLite 備份暫存檔路徑取得失敗。');
    await Share.share({title:'LunaRunes SQLite 紀錄',url:uri,dialogTitle:'儲存或分享 SQLite 備份'});
    return '已交給 iOS 系統分享／儲存；請確認在「檔案」中選擇了儲存位置。';
  }
  const file=new File([bytes],filename,{type:FILE_TYPE});
  const url=URL.createObjectURL(file);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=filename;
  document.body.appendChild(anchor);
  try{anchor.click();}
  finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  return 'SQLite 檔案已交由瀏覽器下載；請在下載清單確認。';
}

export default function RuneSQLiteTransfer({canManage=false,onImported}={}){
  const inputRef=useRef(null);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [preview,setPreview]=useState(null);

  async function exportAll(){
    if(!canManage||busy)return;
    setBusy('export');setMessage('');setPreview(null);
    try{
      // Read the canonical daily records only after the authenticated user's
      // LunaRunes Scope authority has been established by the settings gate.
      const online=(await selectAllRows('silver.lrunes_daily',{
        columns:'record_date,draw_kind,rune_number,direction,recorded_phase',
        orders:[{column:'record_date',ascending:true},{column:'draw_kind',ascending:true}]
      })).rows||[];
      const bytes=await exportRuneSQLite(online);
      const draws=await listLocalRuneDraws();
      const label=await shareSQLite(bytes,'LunaRunes-'+todayInTaipei()+'.sqlite');
      setMessage(label+'（含 '+online.length+' 筆可讀每日紀錄及本機抽牌紀錄；本機抽牌近期 '+draws.length+' 筆可在面板查閱。）');
    }catch(error){setMessage('匯出未完成：'+String(error?.message||error));}
    finally{setBusy('');}
  }
  async function chooseFile(event){
    if(!canManage||busy)return;
    const file=event.target.files?.[0];
    if(!file)return;
    setBusy('inspect');setMessage('');setPreview(null);
    try{
      if(!EXT.test(file.name))throw new Error('只接受 .sqlite、.sqlite3 或 .db 的 SQLite 檔。');
      if(file.size>24*1024*1024)throw new Error('SQLite 檔案超過 24 MB 上限。');
      const bytes=new Uint8Array(await file.arrayBuffer());
      const result=await inspectRuneSQLite(bytes);
      setPreview({fileName:file.name,bytes,result});
      setMessage('已驗證真實 SQLite 檔案及 LunaRunes 表格；請確認合併筆數後匯入。');
    }catch(error){setMessage('匯入檢查失敗：'+String(error?.message||error));}
    finally{setBusy('');if(inputRef.current)inputRef.current.value='';}
  }
  async function confirmImport(){
    if(!canManage||busy||!preview)return;
    setBusy('import');setMessage('');
    try{
      const result=await importRuneSQLite(preview.bytes);
      setMessage('本機 SQLite 合併完成：新增 '+result.addedDraws+' 筆抽牌、'+result.addedDaily+' 筆每日符文；重複鍵已略過。沒有寫入雲端資料庫。');
      setPreview(null);
      onImported?.();
    }catch(error){setMessage('匯入未完成：'+String(error?.message||error));}
    finally{setBusy('');}
  }
  if(!canManage)return null;
  return <section className="loc-card scope-rune-sqlite-transfer" aria-label="每日符文 SQLite 匯出與匯入">
    <h3>每日符文 · SQLite 本機備份</h3>
    <p className="scope-settings-note">僅具月之符文 Scope 權限的登入者可操作。匯出包含目前可讀的每日符文與此裝置保存的抽牌紀錄；匯入只合併進此裝置的專用 SQLite，不修改遠端 SQL 資料庫。請勿將備份視為多人共用紀錄同步。</p>
    <div className="scope-stat-controls">
      <button type="button" className="loc-button" onClick={exportAll} disabled={Boolean(busy)}>匯出所有紀錄</button>
      <button type="button" className="loc-button" onClick={()=>inputRef.current?.click()} disabled={Boolean(busy)}>匯入已有紀錄</button>
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={chooseFile} hidden aria-label="選擇 LunaRunes SQLite 檔"/>
    </div>
    {preview?<div className="scope-inline-card">
      <p><strong>{preview.fileName}</strong></p>
      <p>檔案驗證通過：{preview.result.draws.length} 筆抽牌、{preview.result.daily.length} 筆每日符文。相同主鍵不覆寫。</p>
      <button type="button" className="loc-button primary" onClick={confirmImport} disabled={Boolean(busy)}>確認合併至本機 SQLite</button>
      <button type="button" className="loc-button" onClick={()=>setPreview(null)} disabled={Boolean(busy)}>取消</button>
    </div>:null}
    {message?<p className="scope-status" role="status">{message}</p>:null}
  </section>;
}
