'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {releaseTransientPageResources} from '../../packages/zenstack/client-queries';

// The shared AppShell owns this boundary for ALL route bodies (home,
// Culture, Statistics, Trace, Search, Settings, Manage and Scope pages).
// When Next changes the route, unmount the outgoing tree first, retire its
// transient reads, then permit the next Hero/content tree to mount.
// Initial static/SSR paint is kept intact: a fresh document has no old
// page resources to retire.
export default function PageResourceBoundary({routeKey,children}){
  const key=String(routeKey||'/');
  const [readyKey,setReadyKey]=useState(key);
  const previousKey=useRef(key);

  useLayoutEffect(()=>{
    if(previousKey.current!==key){
      releaseTransientPageResources();
      previousKey.current=key;
      setReadyKey(key);
    }
  },[key]);

  if(readyKey!==key){
    return <main className="scope-main" aria-busy="true">
      <p className="scope-status" role="status">正在釋放上一頁資源…</p>
    </main>;
  }
  return children;
}
