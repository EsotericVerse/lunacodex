'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {prepareTransientResourceAction} from '../../packages/zenstack/client-queries';
import {useEditDock} from './edit-dock';

/**
 * In-page management navigator.
 * In-page horizontal tabs are React selection UI, NOT a Next.js route transition.
 */
export default function ManagementSectionNav({id,title,panelId,items,value,onChange,showDescriptions=false,mobileSelect=false,hideHeading=false}){
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
  return <section className={"management-section-nav"+(mobileSelect?" management-section-nav--mobile-select":"")}
    aria-labelledby={hideHeading?undefined:headingId} aria-label={hideHeading?title:undefined}>
    {!hideHeading?<h2 className="management-section-nav__title" id={headingId}>{title}</h2>:null}
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

// In-page tab changes replace the outgoing panel immediately so its requests,
// editors, and transient work can clean up. Only the newly selected panel fades
// in; route transitions remain owned by PageResourceBoundary.
export function ManagementSectionTransition({value,children,className=''}){
  const reduceMotion=useReducedMotion();
  const previousValue=useRef(value);
  const changed=previousValue.current!==value;
  previousValue.current=value;
  const classes=['management-section-transition',className].filter(Boolean).join(' ');
  return <motion.div key={String(value)} className={classes}
    initial={changed&&!reduceMotion?{opacity:0,y:4}:false}
    animate={{opacity:1,y:0}}
    transition={reduceMotion?{duration:0}:{duration:.18,ease:'easeOut'}}>
    {children}
  </motion.div>;
}

// A selected panel is React state only. Changing it never alters the route or
// query string, and it does not remount the page or jump back to the Hero.
export function useManagementSection(items,defaultValue=''){
  const dock=useEditDock();
  const resolve=raw=>{
    const fallback=items.some(item=>item.value===defaultValue)?defaultValue:items[0]?.value||'';
    return items.some(item=>item.value===raw)?raw:fallback;
  };
  const resolveRef=useRef(resolve);
  resolveRef.current=resolve;
  const [value,setLocalValue]=useState(()=>resolve(''));
  const selectedRef=useRef(value);selectedRef.current=value;
  const dockRef=useRef(dock);dockRef.current=dock;
  const availableSections=items.map(item=>item.value).join('|');
  // Panel selection belongs to this React page. If a native-only panel is
  // removed after hydration, keep the state on the first available panel.
  useEffect(()=>{
    setLocalValue(current=>{
      const next=resolveRef.current(current);
      return current===next?current:next;
    });
  },[availableSections]);
  const setValue=useCallback(next=>{
    if(!items.some(item=>item.value===next)||next===selectedRef.current)return;
    const commit=()=>{
      // Outgoing readers abort on last unmount. Do not reset shared Hero,
      // workspace queries or other still-mounted readers for a tab click.
      prepareTransientResourceAction('selection');
      setLocalValue(next);
    };
    if(dockRef.current?.active)dockRef.current.switchSection(next,commit);
    else commit();
  },[items]);
  return [value,setValue];
}
