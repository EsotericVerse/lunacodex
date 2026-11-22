'use client';

import {useEffect} from 'react';
import {recoverChunkOnce,isChunkLoadFailure} from './loc/ui/chunk-recovery.mjs';

const safeCode=value=>{
  const code=String(value??'');
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code)?code:null;
};

// Route-level error boundary. Never confuse a rendering failure with a failed
// SQL transaction or automatically clear an uncommitted editor draft.
export default function RouteError({error,reset}){
  useEffect(()=>{
    console.error('[LOC route error]',{
      type:safeCode(error?.name)||'Error',
      code:safeCode(error?.code),
      digest:safeCode(error?.digest),
      chunk:isChunkLoadFailure(error)
    });
    // Only chunk failures may reload; the shared helper first checks whether
    // an editor is active and asks before discarding its in-memory draft.
    try{void recoverChunkOnce(error);}catch{/* render the fallback below */}
  },[error]);
  return <main className="loc-next-main">
    <section className="loc-view">
      <header className="loc-hero">
        <p className="loc-eyebrow">LOC</p>
        <h1>頁面發生問題</h1>
        <p>這個頁面暫時無法顯示。重試畫面不會主動修改已儲存資料。</p>
        <button className="loc-button primary" type="button" onClick={()=>reset()}>重試顯示</button>
      </header>
    </section>
  </main>;
}
