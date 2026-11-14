import {motion,useReducedMotion} from 'motion/react';

export default function BottomNavIcon({name}){
  const common={width:23,height:23,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true};
  if(name==='save')return <svg {...common}><path d="M4 4h14l3 3v14H3V4zM7 4v6h10V4M7 21v-8h10v8"/></svg>;
  if(name==='cancel')return <svg {...common}><path d="M5 5l14 14M19 5L5 19"/></svg>;
  if(name==='keywords')return <svg {...common}><path d="M4 7h16M4 12h16M4 17h11M17 15l4 4-4 4"/></svg>;
  if(name==='phone')return <svg {...common}><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>;
  if(name==='home')return <svg {...common}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>;
  if(name==='culture')return <svg {...common}><path d="M6 3h12M6 21h12M8 3v4c0 3 4 4 4 5s-4 2-4 5v4M16 3v4c0 3-4 4-4 5s4 2 4 5v4"/><path d="m9 9 3 3 3-3M9 18h6"/></svg>;
  if(name==='statics')return <svg {...common}><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M3 20h18"/></svg>;
  if(name==='search')return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;
  if(name==='trace')return <svg {...common}><path d="M14 3a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 7.6 4.5 7.6s4.5-4.4 4.5-7.6A4.5 4.5 0 0 0 14 3Z"/><circle cx="14" cy="7.5" r="1.5"/><path d="M8 4H5a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-7M6 17h3l2-2h3"/></svg>;
  return <svg {...common}><path d="M10.5 2.8h3l.5 2.3 1.7.7 2-1.3 2.1 2.1-1.3 2 .7 1.7 2.3.5v3l-2.3.5-.7 1.7 1.3 2-2.1 2.1-2-1.3-1.7.7-.5 2.3h-3l-.5-2.3-1.7-.7-2 1.3-2.1-2.1 1.3-2-.7-1.7-2.3-.5v-3l2.3-.5.7-1.7-1.3-2 2.1-2.1 2 1.3 1.7-.7z"/><circle cx="12" cy="12" r="3"/></svg>;
}

/* Only the six normal feature destinations use these short, one-shot motions.
   The original SVG icon remains the same; edit dock buttons never animate.
   No timers, route interception, layout animation, or animation loops. */
const DOCK_EFFECTS=Object.freeze({
  // Quiet, directional motion on navigation only. No spins, loops or large scaling.
  home:{initial:{x:-2,y:1,scale:.98},frames:{x:[-2,.5,0],y:[1,-.5,0],scale:[.98,1.015,1]},duration:.35},
  culture:{initial:{x:-2,rotate:-2},frames:{x:[-2,1,0],rotate:[-2,1,0]},duration:.4},
  statics:{initial:{y:1,scale:.99},frames:{y:[1,-1,0],scale:[.99,1.02,1]},duration:.34},
  trace:{initial:{x:-2,scaleX:.96,opacity:.88},frames:{x:[-2,.7,0],scaleX:[.96,1.015,1],opacity:[.88,1,1]},duration:.4},
  search:{initial:{x:-1.5,rotate:-4},frames:{x:[-1.5,.8,0],rotate:[-4,2,0]},duration:.39},
  settings:{initial:{rotate:-3,y:1},frames:{rotate:[-3,1,0],y:[1,-.5,0]},duration:.36}
});

export function DockMotionIcon({name,active=false,activation=0}){
  const reduceMotion=useReducedMotion();
  const effect=DOCK_EFFECTS[name==='phone'?'home':name]||DOCK_EFFECTS.home;
  const play=active&&!reduceMotion;
  const key=name+':'+(active?'active-'+activation:'idle');
  return <span className="scope-dock-motion-icon" aria-hidden="true">
    <motion.span key={key} className="scope-dock-motion-icon__glyph"
      initial={play?effect.initial:false}
      animate={play?effect.frames:{x:0,y:0,rotate:0,scale:1,scaleX:1,opacity:1}}
      transition={{duration:play?effect.duration:0,ease:'easeOut'}}
      whileTap={reduceMotion?undefined:{scale:.98}}>
      <BottomNavIcon name={name}/>
    </motion.span>
    {(name==='home'||name==='phone')&&play?<motion.span
      key={key+':center'} className="scope-dock-motion-icon__home-frame"
      initial={{opacity:0,scale:1.06,x:-1}}
      animate={{opacity:[0,.32,0],scale:[1.06,1,1],x:[-1,0,0]}}
      transition={{duration:.38,ease:'easeOut'}}/>:null}
    {name==='statics'&&play?<motion.span key={key+':digits'}
      className="scope-dock-motion-icon__digits"
      initial={{opacity:0,y:3}}
      animate={{opacity:[0,.7,.7,0],x:[-1,0,.5,0],y:[1,0,-.5,0]}}
      transition={{duration:.36,ease:'easeOut'}}
      aria-hidden="true">123</motion.span>:null}
  </span>;
}


/* One persistent selection surface for the six feature keys. The shared
   layoutId animates only on React-preserving routes; on full document loads
   the selected key enters in place. No perpetual effects or blur filters. */
export function DockActiveIndicator(){
  const reduceMotion=useReducedMotion();
  return <motion.span
    aria-hidden="true"
    className="scope-dock-active-pill"
    layoutId="loc-dock-active-pill"
    initial={reduceMotion?false:{opacity:0,scale:.88}}
    animate={{opacity:1,scale:1}}
    transition={reduceMotion?{duration:0}:{
      layout:{type:'spring',stiffness:390,damping:29,mass:.78},
      opacity:{duration:.2},
      scale:{duration:.3,ease:'easeOut'}
    }}
  />;
}
