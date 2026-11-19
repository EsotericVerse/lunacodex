'use client';

import {useLayoutEffect,useRef} from 'react';
import {releaseTransientPageResources} from '../../packages/zenstack/client-queries';

// Route changes retire the old page readers before passive effects run.
// Never replace a fully available page with a "releasing resources" screen,
// and never add an extra render cycle just to dispose transient work.
export default function PageResourceBoundary({routeKey,children}){
  const key=String(routeKey||'/');
  const previousKey=useRef(key);
  useLayoutEffect(()=>{
    if(previousKey.current!==key){
      previousKey.current=key;
      releaseTransientPageResources();
    }
  },[key]);
  return children;
}
