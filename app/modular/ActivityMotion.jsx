'use client';

import {motion,useReducedMotion} from 'motion/react';

// Visual feedback only. Real status, counts and completion are owned by each
// feature's existing request/worker state. No clock, polling or fake progress.
const DIGITS=Object.freeze([0,1,2,3,4,5,6,7,8,9]);
export default function ActivityMotion({kind='hourglass'}){
  const reduceMotion=useReducedMotion();
  if(kind==='numbers')return <span className="loc-work-activity loc-work-activity--numbers" aria-hidden="true">
    {DIGITS.slice(0,3).map((_,index)=><span key={index} className="loc-work-activity__digit-window">
      <motion.span className="loc-work-activity__digit-strip"
        initial={false}
        animate={reduceMotion?{y:0}:{y:['0%','-90%','-25%','-65%','0%']}}
        transition={reduceMotion?{duration:0}:{duration:1.35+index*.18,repeat:Infinity,ease:'easeInOut',delay:index*.12}}>
        {DIGITS.map(number=><span key={number}>{number}</span>)}
      </motion.span>
    </span>)}
  </span>;
  if(kind==='keywords')return <span className="loc-work-activity loc-work-activity--keywords" aria-hidden="true">
    {['文','詞','析'].map((glyph,index)=><motion.span key={glyph}
      initial={false} animate={reduceMotion?{y:0,opacity:1}:{y:[2,-3,2],opacity:[.48,1,.48]}}
      transition={reduceMotion?{duration:0}:{duration:1.15,repeat:Infinity,ease:'easeInOut',delay:index*.18}}>
      {glyph}
    </motion.span>)}
  </span>;
  if(kind==='import')return <span className="loc-work-activity loc-work-activity--import" aria-hidden="true">
    <span>檔</span>
    {[0,1,2].map(index=><motion.span key={index} className="loc-work-activity__packet"
      initial={false} animate={reduceMotion?{x:0,opacity:1}:{x:[-4,5],opacity:[.35,1,.35]}}
      transition={reduceMotion?{duration:0}:{duration:.85,repeat:Infinity,ease:'easeInOut',delay:index*.16}}>·</motion.span>)}
    <span>庫</span>
  </span>;
  return <span className="loc-work-activity loc-work-activity--hourglass" aria-hidden="true">
    <motion.span initial={false} animate={reduceMotion?{rotate:0}:{rotate:[0,180,180,360]}}
      transition={reduceMotion?{duration:0}:{duration:1.65,repeat:Infinity,ease:'easeInOut',times:[0,.44,.56,1]}}>⌛</motion.span>
  </span>;
}
