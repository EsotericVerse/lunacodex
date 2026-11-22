'use client';

import {useEffect} from 'react';

const safeCode=value=>{
  const code=String(value??'');
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code)?code:null;
};

// A root-layout failure must not depend on shared CSS, AppShell, DB, or
// chunk-recovery modules; it owns html/body as Next requires.
export default function GlobalError({error,reset}){
  useEffect(()=>{
    console.error('[LOC global error]',{
      type:safeCode(error?.name)||'Error',
      code:safeCode(error?.code),
      digest:safeCode(error?.digest)
    });
  },[error]);
  return <html lang="zh-Hant">
    <body style={{fontFamily:'system-ui,sans-serif',padding:'2rem',textAlign:'center'}}>
      <h1>LOC 暫時無法顯示</h1>
      <p>畫面載入發生問題。重試不會主動修改已儲存資料。</p>
      <button type="button" onClick={()=>reset()}>重試顯示</button>
    </body>
  </html>;
}
