'use client';

import {useLayoutEffect,useRef} from 'react';
import {animate,useReducedMotion} from 'motion/react';
import {releaseTransientPageResources} from '../../packages/zenstack/client-queries';

// The shell remains mounted. Cleanup is independent of visual motion and
// happens before new passive reads; never retain or remount an outgoing page.
export default function PageResourceBoundary({routeKey,children}){
  const key=String(routeKey||'/');
  const previousKey=useRef(key);
  const content=useRef(null);
  const reduced=useReducedMotion();
  useLayoutEffect(()=>{
    if(previousKey.current===key)return;
    previousKey.current=key;
    releaseTransientPageResources();
  },[key]);
  useLayoutEffect(()=>{
    if(reduced||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    // Animate committed content only. Opacity avoids moving maps, fixed
    // dialogs, editors, or creating a second Hero or loading tree.
    const elements=content.current?.querySelectorAll('.scope-page > .scope-content')||[];
    const animations=Array.from(elements).map(element=>{
      const original=element.style.opacity;
      const restore=()=>{element.style.opacity=original;};
      const control=animate(element,{opacity:[.78,1]},
        {duration:.24,ease:'easeOut',onComplete:restore});
      return ()=>{control.stop();restore();};
    });
    return ()=>animations.forEach(stop=>stop());
  },[key,reduced]);
  return <div ref={content} className="loc-page-motion-boundary">{children}</div>;
}
