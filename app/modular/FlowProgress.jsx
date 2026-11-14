'use client';

import {AnimatePresence,motion,useReducedMotion} from 'motion/react';

// Shared, low-cost progress presentation for keyword scans and imports.
// The river is decorative; all numeric progress comes from real worker/SQL
// receipts. No simulated percentages, polling or timers.
const safeCount=value=>Number.isFinite(Number(value))?
  Math.max(0,Math.floor(Number(value))):0;
const number=value=>safeCount(value).toLocaleString();

export default function FlowProgress({
  kind='import',stage='處理中',completed=0,total=0,detail='',label=''
}={}){
  const reduceMotion=useReducedMotion();
  const count=safeCount(completed),all=safeCount(total);
  const known=all>0;
  const fraction=known?Math.min(1,count/all):0;
  const currentStage=String(stage||'處理中');
  return <div className={'loc-flow-progress loc-flow-progress--'+
      (kind==='keywords'?'keywords':'import')}>
    <div className="loc-flow-progress__header">
      <span className="loc-flow-progress__beacon" aria-hidden="true">
        <span/><span/><span/>
      </span>
      <div className="loc-flow-progress__heading">
        <span className="loc-flow-progress__eyebrow">
          {label||(kind==='keywords'?'語詞流動':'資料流動')}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.strong key={currentStage}
            initial={reduceMotion?false:{opacity:0,y:5}}
            animate={{opacity:1,y:0}}
            exit={reduceMotion?{opacity:1}:{opacity:0,y:-5}}
            transition={{duration:reduceMotion?0:.2}}>
            {currentStage}
          </motion.strong>
        </AnimatePresence>
      </div>
      <span className="loc-flow-progress__count" aria-hidden="true">
        {known?number(count)+' / '+number(all):number(count)}
      </span>
    </div>
    <div className={'loc-flow-progress__river'+(!known?' is-indeterminate':'')}
      role={known?'progressbar':undefined}
      aria-label={known?currentStage+'處理進度':undefined}
      aria-valuemin={known?0:undefined}
      aria-valuemax={known?all:undefined}
      aria-valuenow={known?Math.min(count,all):undefined}>
      <span className="loc-flow-progress__river-fill"
        style={known?{transform:'scaleX('+fraction+')'}:undefined}/>
      <span className="loc-flow-progress__river-glint" aria-hidden="true"/>
    </div>
    <details className="loc-flow-progress__details">
      <summary>處理詳情</summary>
      <div className="loc-flow-progress__detail-body">
        <p>目前階段：{currentStage}</p>
        <p>{known?'已確認 '+number(count)+' / '+number(all)+' 項':
          '已處理 '+number(count)+' 項；總量尚在確認'}</p>
        {detail?<p>{detail}</p>:null}
      </div>
    </details>
  </div>;
}
