'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {motion,useReducedMotion} from 'motion/react';

/**
 * In-page management navigator.
 * In-page horizontal tabs are React selection UI, NOT a Next.js route transition.
 */
export default function ManagementSectionNav({id,title,panelId,items,value,onChange,showDescriptions=false,mobileSelect=false}){
  const activeItem=items.find(item=>item.value===value)||items[0];
  const reduceMotion=useReducedMotion();
  const headingId=id+'-heading';
  const itemsRef=useRef(null);
  useEffect(()=>{
    const list=itemsRef.current;
    const active=list?.querySelector('[aria-pressed="true"]');
    if(!list||!active||list.clientWidth===0)return;
    // Reveal the selected tab within this strip only; never scroll the page.
    const bounds=list.getBoundingClientRect();
    const target=active.getBoundingClientRect();
    if(target.left<bounds.left)list.scrollLeft-=bounds.left-target.left;
    else if(target.right>bounds.right)list.scrollLeft+=target.right-bounds.right;
  },[value]);
  return <section className={"management-section-nav"+(mobileSelect?" management-section-nav--mobile-select":"")} aria-labelledby={headingId}>
    <h2 className="management-section-nav__title" id={headingId}>{title}</h2>
    {mobileSelect?<label className="management-section-nav__mobile-picker">
      <span>選擇功能</span>
      <select value={activeItem?.value||''} onChange={event=>onChange(event.target.value)}
        aria-controls={panelId} aria-label={title}>
        {items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>:null}
    <div ref={itemsRef} className="management-section-nav__items" role="group" aria-label={title}>
      {items.map(item=>{
        const selected=item.value===activeItem?.value;
        return <button
          key={item.value}
          id={id+'-option-'+item.value}
          type="button"
          className="management-section-nav__item"
          aria-label={item.shortLabel&&item.shortLabel!==item.label?item.label:undefined}
          title={item.shortLabel&&item.shortLabel!==item.label?item.label:undefined}
          aria-pressed={selected}
          aria-controls={panelId}
          onClick={()=>{if(!selected)onChange(item.value);}}
        >
          {selected?<motion.span className="management-section-nav__active-indicator"
            layoutId={id+'-selected'} aria-hidden="true"
            transition={reduceMotion?{duration:0}:{type:'spring',duration:.27,bounce:.12}}/>:null}
          <span className="management-section-nav__label">{item.shortLabel||item.label}</span>
          {showDescriptions&&item.description?<span className="management-section-nav__description">{item.description}</span>:null}
        </button>;
      })}
    </div>
  </section>;
}

// The component's React state is the source of truth, so section clicks do
// not navigate or remount the page (and therefore do not jump to the Hero).
// The History API only mirrors selection for deep links/back-forward support.
export function useManagementSection(items,defaultValue='',aliases={}){
  const searchParams=useSearchParams();
  const resolve=raw=>{
    const requested=aliases[raw]||raw;
    const fallback=items.some(item=>item.value===defaultValue)?defaultValue:items[0]?.value||'';
    return items.some(item=>item.value===requested)?requested:fallback;
  };
  const resolveRef=useRef(resolve);
  resolveRef.current=resolve;
  const [value,setLocalValue]=useState(()=>resolve(searchParams?.get('section')||''));
  const availableSections=items.map(item=>item.value).join('|');
  // Native-only sections arrive after hydration. Restore deep links as soon
  // as the section exists, without navigating or scrolling the page.
  useEffect(()=>{
    const requested=new URL(window.location.href).searchParams.get('section')||'';
    setLocalValue(current=>{
      const next=resolveRef.current(requested);
      return current===next?current:next;
    });
  },[availableSections]);
  useEffect(()=>{
    const sync=()=>setLocalValue(resolveRef.current(new URL(window.location.href).searchParams.get('section')||''));
    window.addEventListener('popstate',sync);
    return ()=>window.removeEventListener('popstate',sync);
  },[]);
  const setValue=useCallback(next=>{
    if(!items.some(item=>item.value===next))return;
    // Update the UI immediately; no router.push/replace, no scroll reset.
    setLocalValue(next);
    const url=new URL(window.location.href);
    if(url.searchParams.get('section')!==next){
      url.searchParams.set('section',next);
      window.history.pushState(window.history.state,'',url.pathname+url.search+url.hash);
    }
  },[items]);
  const hrefFor=useCallback(next=>{
    if(!items.some(item=>item.value===next))return '';
    const url=new URL(window.location.href);
    url.searchParams.set('section',next);
    return url.pathname+url.search+url.hash;
  },[items]);
  return [value,setValue,hrefFor];
}
