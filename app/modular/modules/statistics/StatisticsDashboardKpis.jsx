'use client';

import {useEffect,useRef} from 'react';
import {animate,useReducedMotion} from 'motion/react';

function parseAnimatedNumber(value){
  const raw=String(value??'').trim();
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw))return null;
  const normalized=raw.replace(/,/g,'');
  const numeric=Number(normalized);
  if(!Number.isFinite(numeric))return null;
  const fractionDigits=Math.min(6,(normalized.split('.')[1]||'').length);
  return {numeric,fractionDigits};
}

function formatAnimatedNumber(value,fractionDigits){
  return Number(value).toLocaleString('zh-TW',{
    minimumFractionDigits:fractionDigits,
    maximumFractionDigits:fractionDigits
  });
}

// Animate only the text node; never schedule React/chart renders per frame.
// Updates continue from the previous value and preserve decimal precision.
export function AnimatedNumber({value}){
  const ref=useRef(null),previous=useRef(null),reduce=useReducedMotion();
  const parsed=parseAnimatedNumber(value);
  const numeric=parsed?.numeric??null;
  const fractionDigits=parsed?.fractionDigits??0;
  useEffect(()=>{
    const node=ref.current;
    if(!node)return;
    if(numeric===null){
      previous.current=null;
      node.textContent=String(value??'');
      return;
    }
    const from=previous.current;
    previous.current=numeric;
    const format=current=>formatAnimatedNumber(current,fractionDigits);
    if(reduce||from===numeric){
      node.textContent=format(numeric);
      return;
    }
    const controls=animate(from??0,numeric,{
      duration:.45,ease:'easeOut',
      onUpdate:current=>{node.textContent=format(current);}
    });
    return()=>controls.stop();
  },[numeric,fractionDigits,reduce,value]);
  return <span ref={ref} aria-hidden="true">{value}</span>;
}

// Display only: the existing statistics queries own all values.
export default function StatisticsDashboardKpis({items=[],label='Statistics'}){
  return <div className="statistics-dashboard__kpis" aria-label={label}>
    {items.map(item=><div className="statistics-dashboard__kpi" key={item.key}>
      <span className="statistics-dashboard__kpi-label">{item.label}</span>
      <strong className="statistics-dashboard__kpi-value" aria-label={String(item.value)}><AnimatedNumber value={item.value}/></strong>
    </div>)}
  </div>;
}
