'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {dbAuthClient,getAccountSession} from '../../loc/db-client.mjs';

const ALLOWED_SCOPES=['lo3rwang','lrunes'];
const MAX_BATCH_BYTES=601024;
const encoder=new TextEncoder();
function validate(batch){
 if(!batch||typeof batch!=='object'||!Array.isArray(batch.records)||
  !batch.records.length||batch.records.length>50||
  encoder.encode(JSON.stringify(batch)).length>MAX_BATCH_BYTES)
  throw Error('匯入批次格式或大小不正確');
 if(batch.write_mode!=='append')throw Error('只接受 Append-only 寫入');
}
function describe(error){
 const status=Number(error?.status||0);
 if(status===401)return 'LOC 網站登入已失效；資料仍保存在 Extension Queue';
 if(status===403)return '目前 LOC 帳號沒有此 Scope 的文章寫入權限';
 if(status===429)return '寫入頻率已受限制；請稍後再手動傳送';
 return String(error?.message||error||'網站匯入失敗').slice(0,250);
}
export default function GalaxyLinkBridge(){
 const [scopeid,setScopeid]=useState('lo3rwang');
 const [status,setStatus]=useState('網站匯入入口已準備；等待 Extension 傳送');
 const [busy,setBusy]=useState(false);
 const [account,setAccount]=useState('');
 const busyRef=useRef(false);
 const scopeRef=useRef(scopeid);
 scopeRef.current=scopeid;

 // This is a website-owned callable. The extension never sees the site's
 // OAuth/Clerk/LOC delegation tokens and does not create a second Session.
 const ingest=useCallback(async (batch,requestedScope)=>{
  if(busyRef.current)throw Error('前一批仍在寫入中，請稍後再送');
  busyRef.current=true;
  setBusy(true);
  try{
   validate(batch);
   const scope=String(requestedScope||scopeRef.current);
   if(!ALLOWED_SCOPES.includes(scope))throw Error('請先在 LOC 網站選擇有效 Scope');
   setStatus('正在寫入銀河：'+batch.records.length+' 筆');
   const response=await dbAuthClient.shortImport(scope,batch);
   if(response?.accepted!==true||response?.id!==batch.id||!Array.isArray(response?.articles))
    throw Error('LOC 未回傳完整批次確認；Extension Queue 必須保留');
   setStatus('已確認寫入銀河：'+response.articles.length+' 篇來源文章');
   return response;
  }catch(error){
   const message=describe(error);
   setStatus(message);
   throw Error(message);
  }finally{busyRef.current=false;setBusy(false)}
 },[]);
 useEffect(()=>{
  if(typeof window==='undefined')return undefined;
  window.__locGalaxyLinkImport=ingest;
  window.__locGalaxyLinkReady=true;
  return ()=>{
   if(window.__locGalaxyLinkImport===ingest){
    delete window.__locGalaxyLinkImport;
    delete window.__locGalaxyLinkReady;
   }
  };
 },[ingest]);
 const refresh=async()=>{
  setStatus('正在確認 LOC Auth');
  try{
   const result=await getAccountSession();
   const email=result?.oauth?.email||result?.user?.email||'';
   if(!result?.user)throw Error('請先登入 LOC 網站');
   setAccount(email||'已登入 LOC');
   setStatus('LOC Auth 有效；傳送時檢查寫入 Scope');
  }catch(error){setAccount('');setStatus(describe(error))}
 };
 return <main style={{maxWidth:620,margin:'auto',padding:'32px 20px',lineHeight:1.7}}>
  <h1>LOC galaxy-link｜彩虹橋</h1>
  <p>連接屬於你的文字銀河。</p>
  <p>此頁是 LOC 網站提供的 Extension 寫入通道。LOC Auth 維護既有登入狀態，Extension 不接觸 Session、Token 或 MCP。</p>
  <label htmlFor="galaxy-link-scope">網站手動預設目的銀河</label>
  <select id="galaxy-link-scope" value={scopeid} disabled={busy}
   onChange={event=>setScopeid(event.target.value)}
   style={{display:'block',padding:10,margin:'6px 0 18px',minWidth:180}}>
   <option value="lo3rwang">lo3rwang</option>
   <option value="lrunes">lrunes</option>
  </select>
  <button type="button" onClick={refresh} disabled={busy}
   style={{padding:'8px 18px',cursor:'pointer'}}>更新 LOC Auth</button>
  {account?<p>帳號：{account}</p>:null}
  <p role="status" aria-live="polite">{status}</p>
  <p style={{opacity:.75}}>只有送出 Queue 才執行一次文章寫入；寫入失敗時 Extension 保留原本資料，不自動重登。</p>
 </main>;
}
