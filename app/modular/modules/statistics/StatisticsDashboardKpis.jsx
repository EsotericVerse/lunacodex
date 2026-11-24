'use client';

import {useEffect,useRef} from 'react';
import {animate,useReducedMotion} from 'motion/react';

// Animate only the text node; never schedule React/chart renders per frame.
function AnimatedNumber({value}){
  const ref=useRef(null),reduce=useReducedMotion();
  const numeric=Number(String(value).replace(/,/g,''));
  useEffect(()=>{
    if(!ref.current||reduce||!Number.isFinite(numeric)||!Number.isInteger(numeric)||numeric<0)return;
    const node=ref.current;
    const controls=animate(0,numeric,{duration:.45,ease:'easeOut',onUpdate:n=>{node.textContent=Math.round(n).toLocaleString();}});
    return()=>controls.stop();
  },[numeric,reduce]);
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
