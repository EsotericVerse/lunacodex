'use client';

import {useLayoutEffect,useRef} from 'react';
import {releaseTransientPageResources} from '../../packages/zenstack/client-queries';

// The outer navigation / footer remain mounted. Route changes retire the
// previous page's transient readers in a layout effect, before new passive
// data reads begin; never blank the new page just to display a cleanup notice.
export default function PageResourceBoundary({routeKey,children}){
  const key=String(routeKey||'/');
  const previousKey=useRef(key);
  useLayoutEffect(()=>{
    if(previousKey.current===key)return;
    previousKey.current=key;
    releaseTransientPageResources();
  },[key]);
  return children;
}
