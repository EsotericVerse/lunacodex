'use client';

import {useEffect} from 'react';

// Last-resort boundary for errors thrown by the root layout itself. It replaces
// the layout, so it owns <html>/<body> and deliberately uses no site CSS or
// shared modules that could be the thing that failed.
export default function GlobalError({error,reset}){
  useEffect(()=>{console.error('[LOC global error]',error);},[error]);
  return <html lang="zh-Hant">
    <body style={{fontFamily:'system-ui,sans-serif',padding:'2rem',textAlign:'center'}}>
      <h1>LOC 暫時無法顯示</h1>
      <p>已儲存的資料不受影響。</p>
      <button type="button" onClick={()=>reset()}>重新載入</button>
    </body>
  </html>;
}
