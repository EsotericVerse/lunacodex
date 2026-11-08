'use client';

import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {dbAuthRelation} from '../loc/db-client.mjs';
import {selectAllRows} from '../loc/db-query.mjs';
import {writeImportBatches} from '../loc/import-batch.mjs';
import {listLocalDailyRunes,importLocalDailyTransfer} from './local-rune-records.mjs';
import {
  DAILY_TRANSFER_MAX_BYTES,DAILY_TRANSFER_BATCH,analyzeDailyImport,parseDailyCsv,makeDailyTransfer,planDailyTransfer
} from './daily-transfer-contract.mjs';

const FIELDS='record_date,draw_kind,rune_number,direction,recorded_phase';
const bytesOf=source=>new TextEncoder().encode(source);
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});

async function dailyRows(native){
  if(native)return listLocalDailyRunes();
  return (await selectAllRows('silver.lrunes_daily',{
    columns:FIELDS,orders:[{column:'record_date',ascending:true},{column:'draw_kind',ascending:true}]
  })).rows||[];
}
async function downloadFile(content,filename,native,mime='text/csv;charset=utf-8'){
  if(native){
    const [{Filesystem,Directory},{Share}]=await Promise.all([
      import('@capacitor/filesystem'),import('@capacitor/share')
    ]);
    const bytes=bytesOf(content);
    let raw='';
    for(let p=0;p<bytes.length;p+=8192)
      raw+=String.fromCharCode(...bytes.subarray(p,p+8192));
    await Filesystem.writeFile({
      path:filename,directory:Directory.Cache,data:btoa(raw)
    });
    const {uri}=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    if(!uri)throw new Error('無法取得 iOS 備份檔案位置。');
    await Share.share({title:'每日符文備份',url:uri,dialogTitle:'儲存或分享每日符文備份'});
    return '已開啟 iOS 檔案分享／儲存介面。';
  }
  const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:mime}));
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return '已交給瀏覽器下載。';
}
const CSV_COLUMNS=['record_date','draw_kind','rune_number','direction','recorded_phase'];
const csvCell=value=>{
  const text=String(value??'');
  return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
};
const toCsv=records=>[CSV_COLUMNS.join(','),...records.map(row=>CSV_COLUMNS.map(key=>csvCell(row[key])).join(','))].join('\r\n')+'\r\n';

// Personal-settings import/export for daily runes: export is a CSV, import takes
// that same CSV back. Existing (date, kind) records are never overwritten.
export default function DailyRuneTransfer({cloudCanManage=false,onImported}={}){
  const input=useRef(null);
  const [native,setNative]=useState(false);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(null);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{setNative(Capacitor.isNativePlatform());},[]);
  const canImport=native||cloudCanManage;

  async function onExport(){
    if(busy)return;
    setBusy(true);setStatus('');setError('');
    try{
      const list=makeDailyTransfer(await dailyRows(native)).records;
      const result=await downloadFile(toCsv(list),'LunaRunes-Daily-'+today()+'.csv',native);
      setStatus(result+' 共 '+list.length+' 筆。');
    }catch(e){setError('匯出失敗：'+String(e?.message||e));}
    finally{setBusy(false);}
  }
  async function onFile(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file||busy)return;
    setBusy(true);setStatus('');setError('');setProgress(null);
    try{
      if(!/\.csv$/i.test(file.name))throw new Error('不是 CSV 格式，匯入失敗。');
      if(file.size>DAILY_TRANSFER_MAX_BYTES)throw new Error('匯入檔案超過 24 MB。');
      // Strict: only this export's CSV is accepted. Wrong header or any bad row fails the whole file; nothing is written.
      const {header,records:list}=parseDailyCsv(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(await file.arrayBuffer())));
      if(header.length!==CSV_COLUMNS.length||CSV_COLUMNS.some((key,index)=>header[index]!==key))
        throw new Error('欄位不符，必須是匯出的 CSV（'+CSV_COLUMNS.join(',')+'）。');
      const {valid,invalid}=analyzeDailyImport(list);
      if(invalid.length)throw new Error('檔案有 '+invalid.length+' 列無效，整份不匯入：'+invalid.slice(0,3).map(x=>x.error).join('、'));
      const plan=planDailyTransfer(valid,await dailyRows(native));
      let inserted=0;
      if(native){
        inserted=(await importLocalDailyTransfer(plan.fresh)).newCount;
      }else{
        await writeImportBatches(plan.fresh,{
          batchSize:DAILY_TRANSFER_BATCH,
          writeBatch:async batch=>{
            const group=batch.map(row=>({...row,record_id:'transfer:'+row.record_date+':'+row.draw_kind}));
            const {data,error:writeError}=await dbAuthRelation('silver.lrunes_daily')
              .upsert(group,{onConflict:'record_date,draw_kind',ignoreDuplicates:true})
              .select('record_date,draw_kind');
            if(writeError)throw new Error(writeError.message||'分批寫入失敗');
            inserted+=(data||[]).length;
            return {data,error:null};
          },
          onProgress:p=>setProgress(p.percent)
        });
      }
      setStatus('匯入完成：新增 '+inserted+' 筆；已存在 '+plan.duplicateCount+' 筆，衝突 '+plan.conflictCount+
        ' 筆保留原值。');
      onImported?.();
    }catch(e){setError('匯入失敗：'+String(e?.message||e));}
    finally{setBusy(false);setProgress(null);}
  }
  return <section className="loc-card" aria-label="每日符文匯入及匯出">
    <h2>每日符文 · 匯入與匯出</h2>
    <p className="scope-settings-note">匯出為 CSV；匯入只接受同格式的 CSV，其他格式或任何一列有誤，整份匯入失敗、不寫入任何資料；相同日期與種類的紀錄不覆寫。</p>
    <div className="scope-tabs">
      <button type="button" className="loc-button" disabled={busy} onClick={onExport}>匯出每日符文（CSV）</button>
      {canImport?<button type="button" className="loc-button" disabled={busy} onClick={()=>input.current?.click()}>匯入每日符文（CSV）</button>:null}
      <input ref={input} type="file" hidden accept=".csv,text/csv" onChange={onFile} aria-label="選擇每日符文 CSV"/>
    </div>
    {progress!=null?<progress value={progress} max="100"/>:null}
    {status?<p className="scope-status" role="status">{status}</p>:null}
    {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
  </section>;
}
