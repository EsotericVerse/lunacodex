'use client';

import {useEffect} from 'react';
import {recoverChunkOnce} from './loc/ui/chunk-recovery.mjs';

// Route-level boundary: a render error inside one page must not blank the whole
// site. A stale chunk after a deployment gets the same one-time reload that
// AppShell gives window-level failures; anything else shows a retry. The error
// text is logged for diagnosis and never rendered (it may name internals).
export default function RouteError({error,reset}){
  useEffect(()=>{
    console.error('[LOC route error]',error);
    try{void recoverChunkOnce(error);}catch{/* not a chunk failure */}
  },[error]);
  return <main className="loc-next-main">
    <section className="loc-view">
      <header className="loc-hero">
        <p className="loc-eyebrow">LOC</p>
        <h1>頁面發生問題</h1>
        <p>這個頁面暫時無法顯示。已儲存的資料不受影響。</p>
        <button className="loc-button primary" type="button" onClick={()=>reset()}>重新載入此頁</button>
      </header>
    </section>
  </main>;
}
