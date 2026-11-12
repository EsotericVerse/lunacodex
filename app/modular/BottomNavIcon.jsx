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
  home:{initial:{x:-8,y:1,scale:.78},frames:{x:[-8,1.5,0],y:[1,-1,0],scale:[.78,1.09,1]},duration:.48},
  culture:{initial:{x:-4,rotate:-9},frames:{x:[-4,4,-2,0],rotate:[-9,7,-3,0]},duration:.56},
  statics:{initial:{y:0,scale:1},frames:{y:[0,-2,2,-1,0],scale:[1,1.08,.98,1.03,1]},duration:.42},
  trace:{initial:{scaleX:.15,opacity:.65},frames:{scaleX:[.15,1.13,1],opacity:[.65,1,1]},duration:.54},
  search:{initial:{rotate:-70,scale:.85},frames:{rotate:[-70,210,360],scale:[.85,1.08,1]},duration:.58},
  settings:{initial:{rotate:0},frames:{rotate:[0,360]},duration:.62}
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
      whileTap={reduceMotion?undefined:{scale:.9}}>
      <BottomNavIcon name={name}/>
    </motion.span>
    {(name==='home'||name==='phone')&&play?<motion.span
      key={key+':center'} className="scope-dock-motion-icon__home-frame"
      initial={{opacity:0,scale:1.55,x:-5}}
      animate={{opacity:[0,.65,0],scale:[1.55,.9,1],x:[-5,0,0]}}
      transition={{duration:.5,ease:'easeOut'}}/>:null}
    {name==='statics'&&play?<motion.span key={key+':digits'}
      className="scope-dock-motion-icon__digits"
      initial={{opacity:0,y:3}}
      animate={{opacity:[0,1,1,0],x:[0,-2,2,-1,0],y:[3,0,-1,0,0]}}
      transition={{duration:.5,ease:'easeOut'}}
      aria-hidden="true">123</motion.span>:null}
  </span>;
}
