'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {exportLocalGalaxy,importLocalGalaxyFile,listLocalGalaxy} from './local-scope-galaxy.mjs';

const viewTitles={home:'本機資料',culture:'文化',statics:'統計',trace:'痕跡',search:'搜尋'};
const rowsPerPage=50;
function articleDate(row){
  return String(row.date||row.createtime||'').slice(0,10)||'未指定日期';
}
function countBy(rows,key){
  const counts=new Map();
  for(const row of rows){
    const value=String(key(row)||'未分類');
    counts.set(value,(counts.get(value)||0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function localArticle(row){
  return <article key={row.uid} className="loc-local-article">
    <div className="loc-local-article-meta">
      <span>{articleDate(row)}</span><span>{row.site||'local'}</span>
    </div>
    <h3>{row.title||'未命名文章'}</h3>
    <p>{row.list===false?'本文已隱藏':String(row.content||'').slice(0,320)}</p>
    {row.location?<small>地點：{row.location}</small>:null}
  </article>;
}

export default function LocalScopeWorkspace({view='home'}){
  const [native,setNative]=useState(false);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  const [term,setTerm]=useState('');
  const [visible,setVisible]=useState(rowsPerPage);
  const fileInput=useRef(null);
  useEffect(()=>{
    const allowed=Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios';
    setNative(allowed);
    if(!allowed){setLoading(false);return;}
    let valid=true;
    const load=async()=>{
      try{
        const next=await listLocalGalaxy();
        if(valid){setRows(next);setError('');}
      }catch(error){if(valid)setError(String(error?.message||error))}
      finally{if(valid)setLoading(false)}
    };
    void load();
    window.addEventListener('loc-local-data-changed',load);
    return()=>{valid=false;window.removeEventListener('loc-local-data-changed',load)};
  },[]);
  useEffect(()=>setVisible(rowsPerPage),[view,term]);

  const groups=useMemo(()=>countBy(rows,r=>r.site),[rows]);
  const statisticsRows=useMemo(()=>rows.filter(r=>r.statics!==false),[rows]);
  const statisticsGroups=useMemo(()=>countBy(statisticsRows,r=>r.site),[statisticsRows]);
  const dayGroups=useMemo(()=>countBy(statisticsRows,articleDate)
    .sort((a,b)=>b[0].localeCompare(a[0])),[statisticsRows]);
  // A saved Point PK wins over literal location aliases. Without a PK,
  // different location strings stay distinct and are never fuzzy-merged.
  const traceRows=useMemo(()=>rows.filter(r=>r.trace!==false&&(r.place_id||r.location)),[rows]);
  const placeGroups=useMemo(()=>countBy(traceRows,r=>
    r.place_id?'Point '+r.place_id:r.location),[traceRows]);
  const filtered=useMemo(()=>{
    if(view==='trace')return traceRows;
    if(view==='culture')return rows.filter(r=>r.culture!==false);
    if(view==='search'){
      const allowed=rows.filter(r=>r.search!==false);
      if(!term)return allowed;
      const needle=term.toLocaleLowerCase();
      return allowed.filter(r=>[r.title,r.content,r.site,r.location].some(v=>
        String(v||'').toLocaleLowerCase().includes(needle)));
    }
    if(view!=='search'||!term)return rows;
    const needle=term.toLocaleLowerCase();
    return rows.filter(r=>[r.title,r.content,r.site,r.location].some(v=>
      String(v||'').toLocaleLowerCase().includes(needle)));
  },[rows,term,view,traceRows]);

  async function handleImport(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file||busy)return;
    setBusy(true);setError('');setStatus('');
    try{
      const result=await importLocalGalaxyFile(file);
      window.dispatchEvent(new Event('loc-local-data-changed'));
      setStatus('匯入完成：新增 '+result.inserted+' 筆、更新 '+result.updated+' 筆。');
    }catch(error){setError(String(error?.message||error))}
    finally{setBusy(false)}
  }

  async function handleExport(){
    if(busy)return;
    setBusy(true);setStatus('');setError('');
    let temporary='';
    try{
      const json=await exportLocalGalaxy();
      const [{Filesystem,Directory,Encoding},{Share}]=await Promise.all([
        import('@capacitor/filesystem'),import('@capacitor/share')
      ]);
      temporary='loc-local-galaxy-export-'+Date.now()+'.json';
      await Filesystem.writeFile({
        path:temporary,directory:Directory.Cache,
        data:json,encoding:Encoding.UTF8
      });
      const {uri}=await Filesystem.getUri({path:temporary,directory:Directory.Cache});
      if(!uri)throw new Error('無法建立本機匯出檔案');
      await Share.share({title:'LOC 本機 Galaxy',url:uri,dialogTitle:'匯出本機 Galaxy JSON'});
      setStatus('已開啟 iOS 分享／儲存視窗。');
    }catch(error){setError('匯出失敗：'+String(error?.message||error))}
    finally{
      if(temporary){
        try{
          const {Filesystem,Directory}=await import('@capacitor/filesystem');
          await Filesystem.deleteFile({path:temporary,directory:Directory.Cache});
        }catch{}
      }
      setBusy(false);
    }
  }
  if(!native)return <main className="scope-main"><section className="scope-page">
    <section className="loc-card">Local Scope 僅在 iOS App 提供。</section>
  </section></main>;

  const listing=filtered.slice(0,visible);
  return <main className="scope-main loc-local-workspace"><section className="scope-page">
    {view==='home'?<header className="loc-local-hero" aria-labelledby="loc-local-home-title">
      <div className="loc-local-hero-copy">
        <p className="loc-eyebrow">LUNA CODEX · LOCAL SCOPE</p>
        <h1 id="loc-local-home-title">虹月光的本機銀河</h1>
        <p>把資料留在這台 iPhone。簡單匯入、匯出；需要時再限時切換網站的資料核心。</p>
      </div>
      <img src="/assets/site/local/lunarcus-rainbow-hero.avif"
        alt="銀色浮空河流與彩虹橋的 LunArcus 視覺" loading="eager"/>
    </header>:<header className="loc-local-heading">
      <p className="loc-eyebrow">LOCAL SCOPE</p>
      <h1>{viewTitles[view]||'本機銀河'}</h1>
      <p>本頁只讀取這台裝置的 Galaxy，不連接雲端 Scope 資料庫。</p>
    </header>}

    {view==='home'?<section className="loc-card loc-local-transfer" aria-labelledby="loc-local-transfer-title">
      <div><h2 id="loc-local-transfer-title">Galaxy 匯入／匯出</h2>
        <p className="scope-settings-note">使用 Galaxy JSON（文章陣列或 records）。匯入不會清除既有文章；相同 UID 的來源衝突會整批拒絕。</p>
      </div>
      <div className="scope-stat-controls">
        <button className="loc-button primary" type="button" onClick={()=>fileInput.current?.click()}
          disabled={busy||loading}>匯入 JSON</button>
        <button className="loc-button" type="button" onClick={handleExport}
          disabled={busy||loading}>匯出 JSON</button>
        <input type="file" hidden ref={fileInput} accept=".json,application/json"
          onChange={handleImport} aria-label="選擇本機 Galaxy JSON"/>
      </div>
    </section>:null}

    <section className="loc-local-overview" aria-label="本機資料概況">
      <div className="loc-local-kpi"><strong>{rows.length}</strong><span>文章</span></div>
      <div className="loc-local-kpi"><strong>{groups.length}</strong><span>來源</span></div>
      <div className="loc-local-kpi"><strong>{placeGroups.filter(([p])=>p!=='未分類').length}</strong><span>地點</span></div>
    </section>

    {loading?<p role="status">正在開啟本機 Galaxy…</p>:null}
    {status?<p role="status" className="scope-status">{status}</p>:null}
    {error?<p role="alert" className="scope-status scope-error">{error}</p>:null}

    {view==='statics'?<section className="loc-local-section">
      <h2>來源分布</h2>
      {statisticsGroups.map(([site,count])=><div className="loc-local-stat-row" key={site}>
        <span>{site}</span><strong>{count}</strong>
        <meter min="0" max={Math.max(1,rows.length)} value={count} aria-label={site+' 文章占比'}/>
      </div>)}
      <h2>每日文章</h2>
      {dayGroups.slice(0,100).map(([day,count])=><div key={day} className="loc-local-stat-row">
        <span>{day}</span><strong>{count}</strong>
        <meter min="0" max={Math.max(1,rows.length)} value={count} aria-label={day+' 篇數'}/>
      </div>)}
    </section>:null}
    {view==='trace'?<section className="loc-local-section">
      <h2>地點索引</h2>
      <p className="scope-settings-note">依原始 Galaxy.location 精確分組，不以相似地名自行合併。</p>
      {placeGroups.filter(([place])=>place!=='未分類').map(([place,count])=>
        <div key={place} className="loc-local-stat-row"><span>{place}</span><strong>{count} 篇</strong></div>)}
    </section>:null}
    {view==='search'?<section className="loc-local-section">
      <label htmlFor="loc-local-search">搜尋本機文章</label>
      <input className="scope-input" type="search" id="loc-local-search"
        value={term} onChange={event=>setTerm(event.target.value)}
        placeholder="標題、內文、來源或地點"/>
      <p className="scope-settings-note">符合 {filtered.length} 篇。</p>
    </section>:null}
    {view==='culture'||view==='trace'||view==='search'||view==='home'?<section className="loc-local-section" aria-label="本機文章">
      <h2>{view==='culture'?'文化時間序列':view==='trace'?'地點相關文章':view==='search'?'搜尋結果':'最新文章'}</h2>
      {!loading&&filtered.length===0?<p className="scope-settings-note">目前沒有符合條件的本機文章。</p>:null}
      <div className="loc-local-articles">{listing.map(localArticle)}</div>
      {filtered.length>visible?<button type="button" className="loc-button"
        onClick={()=>setVisible(current=>current+rowsPerPage)}>再顯示 {Math.min(rowsPerPage,filtered.length-visible)} 篇</button>:null}
    </section>:null}
  </section></main>;
}
