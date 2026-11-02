'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import * as THREE from 'three';
import {runeGlyphProfile} from './rune-glyph-library.mjs';
import RuneExtrudedGlyph from './RuneExtrudedGlyph';
import {GLYPH_MOTION_TIMES,runeGlyphMotionFor} from './rune-glyph-motion.mjs';
import {AUTHORED_EFFECT_FILES,CANONICAL_RUNE_ENGLISH,runeEffectFor} from './rune-effect-library.mjs';
import {runeIconFor} from './rune-semantic-icons.mjs';
import {groupStageForRune,groupSummonForRune,cinematicCameraPose,GROUP_IMPACT_AT} from './rune-cinematic-language.mjs';
import {redirectHd256ParticleTexture} from './hd256-particle-paths.mjs';
import {redirectSoftMatteTexture} from './soft-matte-textures.mjs';
import {redirectAmbientFogTexture} from './ambient-fog-assets.mjs';

const SOURCE='/vendor/effekseer/';
const WASM=SOURCE+'effekseer.wasm';
// Only pre-authored Effekseer effects with semantically appropriate meanings.
// No custom emitters, particles, shaders, or synthetic effect substitutes.
let runtimePromise;
function loadRuntime(){
  if(typeof window==='undefined')return Promise.reject(new Error('僅支援瀏覽器'));
  if(window.effekseer)return Promise.resolve(window.effekseer);
  runtimePromise ||=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=SOURCE+'effekseer.js';script.async=true;
    script.onload=()=>window.effekseer?resolve(window.effekseer):reject(Error('Effekseer 播放器未啟動'));
    script.onerror=()=>reject(Error('無法載入 Effekseer 播放器'));
    document.head.appendChild(script);
  }).catch(error=>{runtimePromise=null;throw error;});
  return runtimePromise;
}
let wasmPromise;
function readyRuntime(){
  wasmPromise ||=loadRuntime().then(api=>new Promise((resolve,reject)=>{
    let resolved=false;
    try{api.initRuntime(WASM,()=>{resolved=true;resolve(api);},error=>{
      if(!resolved)reject(new Error('Effekseer WebAssembly 載入失敗：'+String(error||'')));
    });}
    catch(error){reject(error);}
  })).catch(error=>{wasmPromise=null;throw error;});
  return wasmPromise;
}
// These small semantic illustrations use the existing Motion library and Unicode
// pictograms. They are not particle systems or replacements for authored VFX.
function SemanticIllustration({word,reduced}){
  if(word==='啟')return <motion.span className="rune-effekseer-gesture rune-effekseer-gesture--awaken"
    aria-hidden="true" initial={reduced?false:{opacity:0,scale:.6,y:20}}
    animate={{opacity:1,scale:1,y:0}}
    transition={{duration:reduced?0:.55,delay:reduced?0:.55,ease:'backOut'}}>
      <span className="rune-effekseer-speech">💡</span>
    </motion.span>;
  if(!['緣','辰','時'].includes(word))return null;
  const actions={
    '緣':{rotate:[-13,10,-7,4,-2,0],scale:[1,1.03,1,1,1,1]},
    '辰':{scale:[.75,1.35,.8,1.2,1]},
    '時':{rotate:[0,0,180,180,360]}
  };
  return <motion.span aria-hidden="true" className="rune-effekseer-gesture rune-effekseer-gesture--hourglass"
    initial={reduced?false:{opacity:0,y:12}}
    animate={reduced?{opacity:1,y:0}:{opacity:[0,1,1,1],y:[12,0,0,0],...actions[word]}}
    transition={{duration:reduced?0:3.3,ease:'easeInOut'}} role="presentation">⌛</motion.span>;
}
// Choreography is a Motion transform on pre-authored pictograms, never DIY particles.
// The stage effect always comes from the distinct licensed Effekseer package.
function iconMotionFor(word){
  const base={opacity:[0,.93,.93,0],scale:[.8,1,1,1]};
  const visual={
    '悟':{scale:[.42,.78,1.24,1],opacity:[0,.55,1,0]},
    '誤':{x:[-24,17,-10,0],rotate:[-14,15,-8,0]},
    '老':{scale:[1.19,1.02,.91,.83],y:[-12,0,15,26]},
    '韻':{scale:[.61,1.22,.8,1.12],opacity:[0,1,.57,0]},
    '葉':{x:[-34,-8,18,0],rotate:[-18,12,-9,0]},
    '草':{y:[45,10,-5,0],scale:[.22,.57,1.11,1]},
    '根':{scaleY:[.07,.37,.75,1],y:[-32,-18,-7,0]},
    '枝':{scaleX:[.18,.49,.86,1.12]},
    '金':{scale:[.61,.93,1.14,1]},
    '玉':{scale:[.84,1.06,.95,1],rotate:[-7,0,2,0]},
    '晶':{scale:[.68,.91,1.08,1],rotate:[-8,-2,4,0]},
    '地':{scale:[.49,.77,.95,1],y:[22,7,1,0]},
    '石':{y:[-65,-14,5,0],rotate:[-9,0,2,0]},
    '鑽':{scale:[.95,1,1,1],opacity:[0,.67,1,0]},
    '礦':{scale:[.43,.68,.88,1],opacity:[0,.38,.75,0]},
    '塵':{x:[-42,-6,40,78],y:[30,5,-12,-31]},
    '火':{y:[33,8,-12,-31],scale:[.66,.86,1,1.05]},
    '氣':{x:[-77,-20,36,96]},
    '日':{scale:[.38,.73,1.05,1],opacity:[0,.67,1,0]},
    '月':{scale:[.95,1,1,1],y:[28,8,0,-3]},
    '星':{x:[50,25,-22,-76],y:[-90,-14,100,170],rotate:[25,28,34,38]},
    '辰':{scale:[.65,1.28,.84,1]},
    '明':{filter:['blur(10px)','blur(3px)','blur(0px)','blur(0px)']},
    '時':{rotate:[0,90,270,360]},
    '空':{scale:[.52,.77,1.16,1.3]},
    '因':{scale:[.38,.67,.93,1],rotate:[-17,-7,0,0]},
    '禍':{scale:[.72,1.2,.87,1],rotate:[-12,8,-4,0]},
    '無':{opacity:[0,.75,.22,0],scale:[1,1,.96,.96]},
    '幻':{filter:['blur(9px)','blur(0px)','blur(4px)','blur(12px)']},
    '緣':{rotate:[-18,13,-6,0]},
    '虛':{scale:[1.27,1,.38,0]},
    '果':{x:[-51,-11,2,0],scale:[.55,.86,1.06,1]},
    '玄':{x:[-18,22,-11,0],rotate:[-23,37,-29,16],scale:[.7,1.2,.87,1]},
    '命':{scale:[.48,.93,1.05,1],rotate:[-75,-18,0,0]},
  };
  return {...base,...(visual[word]||{})};
}
function nameOf(rune){return String(rune?.rune_name||rune?.totem||'光').replace(/之符文$/,'').trim().slice(0,1)||'光';}

/**
 * Ritual choreography controls *presentation only*: the same licensed authored
 * Effekseer file supplies all particles throughout the opening and return.
 * Never create a custom aura/emitter/shader or a second invented effects layer.
 */
export const RITUAL_DURATION=4.8;
export const RITUAL_KEYFRAMES=GLYPH_MOTION_TIMES;
const smoothstep=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
function ritualCameraDistance(t,runeId){
  // Replace the identical dramatic push-in (24 to 10.8) on every rune
  // with five subtle camera passes. The glyph movement provides variety.
  const id=Number(runeId);
  const mode=(Number.isInteger(id)&&id>=1&&id<=66?id-1:0)%5;
  const approach=smoothstep(t/.9)*(1-smoothstep((t-3.05)/1.35));
  const distances=[23.4,25.6,22.5,24,23.1];
  return 24+(distances[mode]-24)*approach;
}


/* Nine group visuals and the waiting animation reuse authored Effekseer files.
 * Each group layer shares the rune's WebGL context; no custom magic effects. */
const RUNE_GROUP_EFFECT_KEYS=Object.freeze([
  'M:Holy2','M:MagicArea','M:Magic1_earth','M:Sylph8',
  'M:Rock1','M:Magic2_wind','SAMPLE:Simple_Ring_Shape2',
  'M:Sylph13','M:Holy1'
]);
function groupEffectFor(rune){
  const id=Number(rune?.rune_id);
  if(!Number.isInteger(id)||id<0||id>66)return null;
  const index=id===0?8:(id<=64?Math.floor((id-1)/8):8);
  const filename=AUTHORED_EFFECT_FILES[RUNE_GROUP_EFFECT_KEYS[index]];
  return filename?{path:SOURCE+filename,tuning:{scale:1.8,speed:.72}}:null;
}
// The older waiting asset remains for the separate board-game Resonance stage.
const WAITING_AUTHORED_EFFECT=Object.freeze({
  path:SOURCE+AUTHORED_EFFECT_FILES['M:MagicArea'],tuning:{scale:2.2,speed:.8}
});
function drawPreludeForRune(runeId){
  const id=Number(runeId);
  if(!Number.isInteger(id)||id<1||id>66)return null;
  return runeEffectFor({english_name:CANONICAL_RUNE_ENGLISH[id]});
}

function EffekseerCanvas({effect,runeId,reduced,onReady,onPlaybackComplete,ceremony=false,groupEffect=null,groupStage=null,waiting=false,ambient=false,ambientDepth='rear',ambientPaused=false,quality='high',textureQuality='original',diagnoseAmbient=false}){
  const canvas=useRef(null);
  const onPlaybackCompleteRef=useRef(onPlaybackComplete);
  onPlaybackCompleteRef.current=onPlaybackComplete;
  const ambientPauseRef=useRef(ambientPaused);
  ambientPauseRef.current=ambientPaused;
  const [status,setStatus]=useState('正在啟動 Effekseer…');
  useEffect(()=>{
    let active=true,frame=0,observer;
    let renderer,context,clock;
    const target=canvas.current;
    if(reduced){setStatus('');onReady?.();onPlaybackCompleteRef.current?.();return;}
    if(!effect){setStatus('');onReady?.();onPlaybackCompleteRef.current?.();return;}
    (async()=>{
      try{
        const api=await readyRuntime();
        if(!active||!target)return;
        // The authored Effekseer particles are straight-alpha by default.
        // The dedicated ambient fog context explicitly opts into premultiplied-alpha;
        // match WebGL canvas composition to the corresponding Effekseer output.
        renderer=new THREE.WebGLRenderer({canvas:target,alpha:true,premultipliedAlpha:ambient,
          antialias:quality==='high'&&!ambient,powerPreference:'high-performance'});
        renderer.setClearColor(0,0);
        const camera=new THREE.PerspectiveCamera(35,1,1,1000);
        camera.position.set(0,0,24);
        camera.lookAt(0,0,0);camera.updateMatrixWorld();
        const resize=()=>{
          const r=target.getBoundingClientRect();
          if(!r.width||!r.height)return;
          const maxDpr=ambient?(quality==='high'?1.5:1):quality==='high'?3:1.2;
          const deviceDpr=window.devicePixelRatio||1;
          const renderDpr=!ambient&&quality==='high'
            ?Math.min(Math.max(deviceDpr,2),maxDpr)
            :Math.min(deviceDpr,maxDpr);
          renderer.setPixelRatio(renderDpr);
          renderer.setSize(Math.round(r.width),Math.round(r.height),false);
          camera.aspect=r.width/r.height;camera.updateProjectionMatrix();camera.updateMatrixWorld();
        };
        resize();
        observer=new ResizeObserver(resize);
        observer.observe(target);
        context=api.createContext();
        // EffekseerForWebGL defaults to unpremultiplied output, whereas
        // Three.WebGLRenderer defaults to a premultiplied-alpha canvas.
        // The mismatch makes transparent particle billboards composite poorly.
        // Match the two ONLY in the isolated ambient fog context.
        context.init(renderer.getContext(),ambient?{enablePremultipliedAlpha:true}:undefined);
        const hd256Redirect=textureQuality==='hd256'?redirectHd256ParticleTexture:undefined;
        let groupHandle=null,groupBaseline=1;
        let impactAsset=null,impactReady=false,impactStarted=false;
        if(ceremony&&groupStage&&AUTHORED_EFFECT_FILES[groupStage.impact]){
          impactAsset=context.loadEffect(SOURCE+AUTHORED_EFFECT_FILES[groupStage.impact],1,
            ()=>{if(active)impactReady=true;},()=>{impactReady=false;},hd256Redirect);
        }
        if(groupEffect){
          let groupAsset;
          groupAsset=context.loadEffect(groupEffect.path,1,()=>{
            if(!active)return;
            try{
              groupHandle=context.play(groupAsset,0,0,0);
              const groupSize=groupEffect.tuning?.scale||1;
              groupBaseline=groupSize;
              groupHandle.setScale(groupSize,groupSize,groupSize);
              if(groupEffect.tuning?.speed)groupHandle.setSpeed(groupEffect.tuning.speed);
            }catch(error){if(active)setStatus('群組特效無法播放：'+String(error?.message||error));}
          },(message,url)=>{if(active)setStatus('群組 Effekseer 素材載入失敗：'+String(message||url));},hd256Redirect);
        }
        // The effect data, materials and textures remain exactly as authored.
        const effectFile=effect.path;
        // Official Effekseer WebGL accepts a fifth argument: redirect(path).
        // Only this authored smoke emitter receives a genuine native 2048×2048
        // CC0 transparent cloud texture, not an enlarged 128×128 sprite.
        // Original .efkefc files and the 66 rune VFX remain unchanged.
        const fogRequests=new Set(),fogRedirects=new Set();
        const textureRedirect=ambient&&effectFile.endsWith('/MxS_foot_smoke2.efkefc')
          ?(path)=>{
            fogRequests.add(String(path).replaceAll('\\','/').split('/').pop());
            return redirectAmbientFogTexture(path,{quality:textureQuality,
              onReplacement:({original,replacement})=>fogRedirects.add(original+' → '+replacement)});
          }
          :['M:foot_smoke2','M:Sylph10'].includes(effect.key)
            ?redirectSoftMatteTexture
            :hd256Redirect;
        let loaded,started=false,playingHandle=null,settledEffectStarted=false,ambientLastSpawn=0,ambientRetire=null;
        let ambientGhost=null,ambientGhostRetire=null;
        const extras=[];
        loaded=context.loadEffect(effectFile,1,()=>{
          if(!active)return;
          if(ambient&&diagnoseAmbient){
            const attrs=renderer.getContext()?.getContextAttributes?.();
            setStatus('Effekseer 原生霧氣 '+(ambientDepth==='rear'?'遠景':'前景')+
              '｜載入成功｜請求：'+([...fogRequests].join('、')||'無')+
              '｜替換：'+([...fogRedirects].join('、')||'未命中')+
              '｜WebGL alpha='+String(attrs?.alpha)+
              ' premultipliedAlpha='+String(attrs?.premultipliedAlpha));
          }else setStatus('');
          try{
             const handle=context.play(loaded,0,0,0);
             playingHandle=handle;
             const tuning=effect.tuning;
             if(tuning?.scale)handle.setScale(tuning.scale,tuning.scale,tuning.scale);
             if(tuning?.rotationZ!==undefined)handle.setRotation(0,0,tuning.rotationZ);
             if(tuning?.speed)handle.setSpeed(tuning.speed);
             if(tuning?.color)handle.setAllColor(...tuning.color);
             started=true;
             ambientLastSpawn=0;
             if(ambient&&ambientDepth==='rear'&&quality==='high'){
               try{
                 ambientGhost=context.play(loaded,0,0,0);
                 const g=(effect.tuning?.scale||1)*.69;
                 ambientGhost.setScale(g,g,g);
                 ambientGhost.setAllColor(207,217,233,115);
                 ambientGhost.setSpeed(.39);
                 ambientGhost.setLocation(-1.7,.55,-4.2);
               }catch(error){if(active)setStatus('遠景霧氣無法播放：'+String(error?.message||error));}
             }
             // Overlay authored assets only when the base effect has loaded successfully.
             for(const overlay of effect.overlays||[]){
               const overlayTextureRedirect=overlay.role==='jade-reflection'
                 ?redirectSoftMatteTexture:hd256Redirect;
               let authoredOverlay;
               authoredOverlay=context.loadEffect(overlay.path,1,()=>{
                 if(!active||!started)return;
                 try{
                   const other=context.play(authoredOverlay,0,0,0);
                   if(overlay.role==='mirror-surface'){
                     other.setScale(-1.2,1.5,1.2);
                     other.setAllColor(236,239,242,180);
                   }
                   else if(overlay.role.startsWith('cross-')){
                     other.setScale(1.65,1.65,1.65);
                     other.setRotation(0,0,overlay.role==='cross-forward'?Math.PI/4:-Math.PI/4);
                     other.setAllColor(255,70,78,255);
                   }else if(overlay.role==='flame-projectile'){
                     // A separately authored fireball gives Flame a defined luminous core.
                     // Keep the artist's native palette; no synthetic particle emitters.
                     other.setScale(1.35,1.35,1.35);
                     other.setSpeed(.9);
                   }else if(overlay.role==='jade-reflection'){
                     other.setScale(1.04,.9,1.04);
                     other.setAllColor(150,234,186,132);
                   }else if(overlay.role==='dust-left'||overlay.role==='dust-right'){
                     const sign=overlay.role==='dust-left'?-1:1;
                     other.setScale(.8,.95,.8);
                     other.setLocation(sign*.45,-.15,0);
                     other.setAllColor(188,181,165,95);
                   }else if(overlay.role==='root-outer-left'||overlay.role==='root-outer-right'){
                     const sign=overlay.role==='root-outer-left'?-1:1;
                     other.setScale(.55,1.35,.6);
                     other.setRotation(0,0,sign*.75);
                     other.setAllColor(131,100,72,225);
                   }else if(overlay.role==='branch-outer-left'||overlay.role==='branch-outer-right'){
                     const sign=overlay.role==='branch-outer-left'?-1:1;
                     other.setScale(.65,1.2,.65);
                     other.setRotation(0,0,sign*.8);
                     other.setAllColor(140,207,130,225);
                   }else if(overlay.role==='root-left'||overlay.role==='root-right'){
                     const sign=overlay.role==='root-left'?-1:1;
                     other.setScale(.7,.9,.7);
                     other.setRotation(0,0,sign*.52);
                     other.setLocation(sign*.35,.2,0);
                     other.setAllColor(151,121,88,255);
                   }else if(overlay.role==='branch-left'||overlay.role==='branch-right'){
                     const sign=overlay.role==='branch-left'?-1:1;
                     other.setScale(.7,1.1,.7);
                     other.setRotation(0,0,sign*.56);
                     other.setLocation(sign*.38,.3,0);
                     other.setAllColor(140,181,125,255);
                   }else if(overlay.role==='mirror-frame'){
                     other.setScale(1.45,1.8,1.45);
                     other.setAllColor(218,231,242,230);
                   }else if(overlay.role==='counter-orbit'){
                     other.setScale(1.95,1.95,1.95);
                     other.setAllColor(149,210,255,255);
                   }
                   extras.push({handle:other,role:overlay.role});
                 }catch(error){if(active)setStatus('附加特效無法播放：'+String(error?.message||error));}
               },(message,url)=>{if(active)setStatus('附加 Effekseer 素材載入失敗：'+String(message||url));},overlayTextureRedirect);
             }
             started=true;
           }catch(error){setStatus('特效無法播放：'+String(error?.message||error));}
          onReady?.();
        },(message,url)=>{if(active){setStatus('特效素材載入失敗：'+String(message||url));onReady?.();onPlaybackCompleteRef.current?.();}},textureRedirect);
        clock=new THREE.Clock();
        let elapsed=0;
        const draw=()=>{
          if(!active)return;
          const delta=Math.min(clock.getDelta(),.05);
          if(started&&!document.hidden&&!ambientPauseRef.current){
            elapsed+=delta;
            if(ambient&&elapsed-ambientLastSpawn>=3.4){
              ambientLastSpawn=elapsed;
              // Overlap short, licensed smoke clips to avoid an empty sky.
              // The old handle is stopped through Effekseer's native API.
              ambientRetire?.stop?.();
              ambientRetire=playingHandle;
              if(ambientGhost){
                ambientGhostRetire?.stop?.();
                ambientGhostRetire=ambientGhost;
                ambientGhost=null;
              }
              try{
                playingHandle=context.play(loaded,0,0,0);
                const effectScale=effect.tuning?.scale||1;
                playingHandle.setScale(effectScale,effectScale,effectScale);
                if(effect.tuning?.speed)playingHandle.setSpeed(effect.tuning.speed);
                if(effect.tuning?.color)playingHandle.setAllColor(...effect.tuning.color);
                if(ambientDepth==='rear'&&quality==='high'){
                  ambientGhost=context.play(loaded,0,0,0);
                  const g=effectScale*.69;
                  ambientGhost.setScale(g,g,g);
                  ambientGhost.setAllColor(207,217,233,115);
                  ambientGhost.setSpeed(.39);
                  ambientGhost.setLocation(-1.7,.55,-4.2);
                }
              }catch(error){if(active)setStatus('霧氣重播失敗：'+String(error?.message||error));}
            }
            if(ceremony){
              const pose=cinematicCameraPose(elapsed,groupStage,ritualCameraDistance(elapsed,runeId));
              camera.position.set(pose.x,pose.y,pose.z);
              camera.lookAt(0,0,0);
              camera.updateMatrixWorld();
              if(!impactStarted&&impactReady&&elapsed>=GROUP_IMPACT_AT&&elapsed<=1.45){
                impactStarted=true;
                try{
                  const impact=context.play(impactAsset,0,0,0);
                  const scale=groupStage.impactScale*(quality==='high'?1:.73);
                  impact.setScale(scale,scale,scale);
                  impact.setSpeed(groupStage.impactSpeed);
                  const c=groupStage.impactColor;
                  impact.setAllColor(c[0],c[1],c[2],Math.round(c[3]*(quality==='high'?1:.68)));
                }catch(error){if(active)setStatus('高潮衝擊素材無法播放：'+String(error?.message||error));}
              }
              if(groupHandle&&groupStage){
                const approach=Math.min(1,elapsed/1.15);
                const returnFactor=1-smoothstep((elapsed-3.2)/1.3);
                const breathe=1+.07*Math.sin(elapsed*(groupStage.style==='surge'?6:2.1));
                const grow=groupBaseline*(.62+.38*approach)*returnFactor*breathe;
                groupHandle.setScale(grow,grow,grow);
                if(groupStage.style==='converge')groupHandle.setRotation(0,0,Math.sin(elapsed*.9)*.18);
                else if(groupStage.style==='displace')groupHandle.setLocation(Math.sin(elapsed*3)*.38,.1*Math.cos(elapsed*4),0);
                else if(groupStage.style==='rise')groupHandle.setLocation(0,-.65+Math.min(1,elapsed/2)*.95,0);
                else if(groupStage.style==='weight')groupHandle.setLocation(0,.4-Math.min(1,elapsed)*.4,0);
              }
            }
            if(!ambient&&elapsed>=(ceremony?8.7:waiting?(effect.key?2.8:1.4):4.8)){
              // One finite reveal, without a persistent blank WebGL animation loop.
              context.stopAll();
              renderer.clear();
              if(!ceremony&&!waiting&&!ambient)onPlaybackCompleteRef.current?.();
              return;
            }
            // Move the actual licensed Effekseer effect handle, not a decorative SVG.
            // These fixed transforms never emit particles or alter the authored package.
            const tuning=effect.tuning;
            if(playingHandle&&ambient){
              // Effekseer-authored smoke at native 3D depth coordinates.
              const foreground=ambientDepth==='foreground';
              playingHandle.setLocation(
                Math.sin(elapsed*(foreground?.3:.21))*(foreground?1.18:.95),
                (foreground?-1.3:-.75)+Math.sin(elapsed*.15)*.18,foreground?3:0);
              if(ambientGhost){
                ambientGhost.setLocation(-1.7+Math.sin(elapsed*.19)*.48,.55+Math.cos(elapsed*.2)*.2,-4.2);
              }
            }
            if(playingHandle&&tuning?.motion){
              const base=tuning.scale||1;
              const phase=elapsed/4.8;
              switch(tuning.motion){
                case 'collapse': {
                  const size=base*Math.pow(Math.max(0,1-phase),2);
                  playingHandle.setScale(size,size,size);break;
                }
                case 'pulse': {
                  const size=base*(1+.21*Math.sin(elapsed*2*Math.PI*3.5));
                  playingHandle.setScale(size,size,size);break;
                }
                case 'hourglass-scale': {
                  const size=base*(1+.24*Math.sin(elapsed*2*Math.PI/2.1));
                  playingHandle.setScale(size,size,size);break;
                }
                case 'hourglass-turn':playingHandle.setRotation(0,0,elapsed*2*Math.PI/3.2);break;
                case 'hourglass-wobble':playingHandle.setRotation(0,0,.37*Math.exp(-elapsed*.9)*Math.sin(elapsed*14));break;
                case 'chaotic':{
                  const s=base*(1+.14*Math.sin(elapsed*11)+.11*Math.cos(elapsed*17));
                  playingHandle.setScale(s,s,s);playingHandle.setRotation(0,0,.31*Math.sin(elapsed*9));break;
                }
                case 'chaos-orbit':playingHandle.setRotation(0,0,elapsed*1.95);break;
                case 'revelation':{
                  const s=base*(.45+.55*Math.min(1,elapsed/.85));
                  playingHandle.setScale(s,s,s);break;
                }
                case 'sprout':{
                  const s=base*(.28+.72*Math.min(1,phase*1.8));
                  playingHandle.setScale(s,s,s);playingHandle.setLocation(0,-1.5+1.75*Math.min(1,phase*1.8),0);break;
                }
                case 'root-down':playingHandle.setLocation(0,.9-2.4*Math.min(1,phase*1.4),0);break;
                case 'root-branch-down':{
                  const grow=Math.min(1,elapsed/2.8);
                  playingHandle.setLocation(0,.6-2.3*grow,0);
                  playingHandle.setScale(base*(.35+.65*grow),base*(.35+.65*grow),base);
                  break;
                }
                case 'branch-up':{
                  const grow=Math.min(1,elapsed/2.5);
                  playingHandle.setLocation(0,-.85+2.1*grow,0);
                  playingHandle.setScale(base*(.35+.65*grow),base*(.35+.65*grow),base);
                  break;
                }
                case 'root-spread':{
                  const g=Math.min(1,elapsed/2.9);
                  playingHandle.setScale(base*(.18+.82*g),base*(.32+.68*g),base);
                  playingHandle.setLocation(0,.65-1.7*g,0);break;
                }
                case 'branch-out':{
                  const grow=Math.min(1,phase*1.7);
                  playingHandle.setScale(.28+base*grow,base*(.4+.6*grow),base);break;
                }
                case 'ore-rise':{
                  const rise=Math.min(1,phase*1.5);
                  playingHandle.setLocation(0,-2+2.7*rise,0);
                  playingHandle.setScale(base*(.38+.62*rise),base*(.38+.62*rise),base);break;
                }
                case 'dust-drift':playingHandle.setLocation(-1.15+phase*2.45,.2+Math.sin(elapsed*.8)*.38,0);break;
                case 'space-contract':{
                  const s=base*(1.35-.85*Math.min(1,phase*1.6));
                  playingHandle.setScale(s,s,s);break;
                }
                case 'mist':playingHandle.setLocation(Math.sin(elapsed*.7)*.38,Math.cos(elapsed*.43)*.23,0);break;
                case 'mist-drift':{
                  playingHandle.setLocation(-1.1+elapsed*.52,Math.sin(elapsed*.65)*.24,0);
                  playingHandle.setAllColor(207,204,221,Math.round(55+105*Math.sin(Math.min(1,phase)*Math.PI)));
                  break;
                }
                case 'clarify':{
                  const g=Math.min(1,elapsed/2.2);
                  playingHandle.setAllColor(255,255,245,Math.round(30+225*g));
                  playingHandle.setScale(base*(.7+.3*g),base*(.7+.3*g),base);
                  break;
                }
                case 'fate-converge':{
                  const r=1.6*Math.pow(Math.max(0,1-phase),1.3);
                  playingHandle.setLocation(Math.cos(elapsed*2.1)*r,Math.sin(elapsed*2.1)*r,0);
                  playingHandle.setRotation(0,0,elapsed*.45);break;
                }
                case 'radiate':{
                  const s=base*(.85+.13*Math.sin(elapsed*2.2));playingHandle.setScale(s,s,s);break;
                }
                case 'gentle':playingHandle.setRotation(0,0,.05*Math.sin(elapsed*.8));break;
                case 'facet':playingHandle.setRotation(0,0,.12*Math.sin(elapsed*.9));break;
                case 'weight':playingHandle.setLocation(0,.45-.45*Math.min(1,elapsed/.55),0);break;
                case 'reflect':playingHandle.setRotation(0,0,.06*Math.sin(elapsed*1.1));break;
                case 'result':{
                  const size=base*(.6+.4*Math.min(1,elapsed/.95));playingHandle.setScale(size,size,size);break;
                }
                default:break;
              }
              for(const {handle,role} of extras){
                if(role==='counter-orbit')handle.setRotation(0,0,-elapsed*2.3);
                else if(role==='root-left'||role==='root-right'){
                  const sign=role==='root-left'?-1:1,g=Math.min(1,elapsed/3.2);
                  handle.setLocation(sign*(.2+1.2*g),.15-1.6*g,0);
                  handle.setRotation(0,0,sign*(.27+.42*g));
                }else if(role==='dust-left'||role==='dust-right'){
                  const sign=role==='dust-left'?-1:1;
                  handle.setLocation(sign*(.5+elapsed*.19),-.2+Math.sin(elapsed*.65)*.22,0);
                }else if(role==='root-outer-left'||role==='root-outer-right'){
                  const sign=role==='root-outer-left'?-1:1,g=Math.min(1,elapsed/3.2);
                  handle.setLocation(sign*(.25+1.55*g),.2-2.4*g,0);
                  handle.setScale(.15+.9*g,.2+1.2*g,.6);
                }else if(role==='branch-outer-left'||role==='branch-outer-right'){
                  const sign=role==='branch-outer-left'?-1:1,g=Math.min(1,elapsed/2.5);
                  handle.setLocation(sign*(.3+1.45*g),-.65+2.3*g,0);
                  handle.setScale(.18+1.0*g,.3+1.3*g,.65);
                }else if(role==='branch-left'||role==='branch-right'){
                  const sign=role==='branch-left'?-1:1,g=Math.min(1,elapsed/2.6);
                  handle.setLocation(sign*(.27+1.45*g),.3+.75*g,0);
                  handle.setScale(.25+1.0*g,.3+1.0*g,.7);
                }
              }
            }
            // After the grand arrival, replay the SAME authored file at reduced
            // footprint; the final composition remains calm instead of vanishing.
            if(ceremony&&started&&!settledEffectStarted&&elapsed>=4.65){
              settledEffectStarted=true;
              try{
                const small=context.play(loaded,0,0,0);
                const authoredScale=(effect.tuning?.scale||1)*.58;
                small.setScale(authoredScale,authoredScale,authoredScale);
                if(effect.tuning?.color)small.setAllColor(...effect.tuning.color);
                if(effect.tuning?.speed)small.setSpeed(effect.tuning.speed*.82);
              }catch(error){if(active)setStatus('特效歸位失敗：'+String(error?.message||error));}
            }
            context.update(delta*60);
            context.setProjectionMatrix(camera.projectionMatrix.elements);
            context.setCameraMatrix(camera.matrixWorldInverse.elements);
            renderer.clear();
            context.draw();
            renderer.resetState();
          }
          frame=requestAnimationFrame(draw);
        };
        draw();
      }catch(error){if(active){setStatus('Effekseer 無法啟動：'+String(error?.message||error));onReady?.();onPlaybackCompleteRef.current?.();}}
    })();
    return()=>{
      active=false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      try{context?.stopAll();}catch{}
      try{context?.release();}catch{}
      try{renderer?.dispose();}catch{}
    };
  },[effect,runeId,reduced,ceremony,groupEffect,groupStage,waiting,ambient,ambientDepth,quality,textureQuality,diagnoseAmbient]);
  return <div className="rune-effekseer-canvas-wrap">
    <canvas ref={canvas} className="rune-effekseer-canvas" aria-hidden="true"/>
    {(!ambient||diagnoseAmbient)&&status?<p className={'rune-effekseer-status'+(diagnoseAmbient?' rune-effekseer-fog-diagnostic':'')} role="status">{status}</p>:null}
  </div>;
}

// Persistent moonlit mist comes exclusively from an already vendored Effekseer
// file. Its breathing/clearing is playback and composition, never DIY particles.
const AUTHORED_MOON_MIST=Object.freeze({
  path:SOURCE+AUTHORED_EFFECT_FILES['M:foot_smoke2'],
  tuning:{scale:3.0,speed:.42,color:[223,227,238,185]}
});
const AUTHORED_FOREGROUND_MIST=Object.freeze({
  path:SOURCE+AUTHORED_EFFECT_FILES['M:foot_smoke2'],
  tuning:{scale:1.6,speed:.37,color:[225,225,239,135]}
});
export function RuneMistBackdrop({phase='idle',quality='high',textureQuality='original',diagnoseAmbient=false}){
  const reduced=useReducedMotion();
  const clearing=phase==='waiting'||phase==='revealing';
  return <>
    <div className="rune-3d-mist-backdrop" data-clearing={clearing?'true':'false'}
      data-quality={quality} aria-hidden="true">
      <EffekseerCanvas effect={AUTHORED_MOON_MIST} reduced={reduced}
        ambient ambientDepth="rear" ambientPaused={phase==='revealing'} quality={quality} textureQuality={textureQuality} diagnoseAmbient={diagnoseAmbient}/>
    </div>
    {quality==='high'&&!reduced?<div className="rune-3d-foreground-mist"
      data-ritual-mist={phase} aria-hidden="true">
      <EffekseerCanvas effect={AUTHORED_FOREGROUND_MIST} reduced={reduced}
        ambient ambientDepth="foreground" ambientPaused={phase==='revealing'} quality={quality} textureQuality={textureQuality} diagnoseAmbient={diagnoseAmbient}/>
    </div>:null}
  </>;
}

export function WaitingEffekseerStage({textureQuality='original',runeId=null}){
  const reduced=useReducedMotion();
  const selectedEffect=useMemo(()=>drawPreludeForRune(runeId),[runeId]);
  return <div className="rune-effekseer-stage" data-source="authored-rune-prelude"
    data-effect-key={selectedEffect?.key||undefined}>
    <EffekseerCanvas effect={selectedEffect} reduced={reduced} waiting textureQuality={textureQuality}/>
  </div>;
}
export default function EffekseerStage({rune,onGlyphClick,vfxOnly=false,direction=null,ceremony=false,appearance='glyph',cardSrc=null,onCeremonyComplete=null,onPlaybackComplete=null,quality='high',textureQuality='original'}){
  const reduced=useReducedMotion();
  const [replay,setReplay]=useState(0);
  const [visibleKey,setVisibleKey]=useState('');
  const completedRef=useRef(false);
  const word=nameOf(rune);
  const profile=runeGlyphProfile(rune);
  const key=String(rune?.rune_id??word)+'-'+word+'-'+replay;
  const effect=useMemo(()=>runeEffectFor(rune),[rune?.english_name]);
  const semanticIcon=runeIconFor(rune);
  const visualReady=reduced||!effect||visibleKey===key;
  const showCard=ceremony&&appearance==='card'&&Boolean(cardSrc);
  const letterMotion=useMemo(()=>runeGlyphMotionFor(rune,{ceremony}),[rune?.rune_id,word,ceremony]);
  useEffect(()=>{completedRef.current=false;},[key]);
  useEffect(()=>{
    if(ceremony&&reduced&&!completedRef.current){
      completedRef.current=true;
      onCeremonyComplete?.();
    }
  },[ceremony,reduced,key]);
  return <div className="rune-effekseer-stage" data-source="effekseer" data-rune={word}
    data-ceremony={ceremony?'summoning':undefined}
    data-glyph-weight={letterMotion.weight||'measured'}
    data-quality={quality} data-texture-quality={textureQuality} data-effect-key={effect?.key||''}
    data-direction={direction==='正位'?'upright':direction==='半正位'?'semi-upright':direction==='半逆位'?'semi-reversed':direction==='逆位'?'reversed':undefined}>
    <EffekseerCanvas key={key} effect={effect} runeId={rune?.rune_id} reduced={reduced} ceremony={ceremony} quality={quality} textureQuality={textureQuality} onPlaybackComplete={onPlaybackComplete} onReady={()=>setVisibleKey(key)}/>
    <div className="rune-effekseer-glyph-position">
      <AnimatePresence mode="wait">
        {visualReady?<motion.button key={key} type="button"
          className={showCard?'rune-effekseer-ceremony-card':'rune-effekseer-glyph rune-effekseer-glyph--'+profile.font}
          data-glyph-family={profile.family} data-glyph-finish={profile.finish} data-glyph-motion={letterMotion.style} data-glyph-weight={letterMotion.weight||'measured'} data-glyph-ink={profile.ink}
          style={{'--rune-ink':profile.ink}}
          aria-label={onGlyphClick?'查看 '+word+' 之符文':word+'符文特效展示'}
          onClick={onGlyphClick} disabled={!onGlyphClick}
          initial={reduced?false:{opacity:0}}
          animate={reduced?{opacity:1,scale:1}:letterMotion.frames}
          onAnimationComplete={()=>{
            if(ceremony&&!completedRef.current){
              completedRef.current=true;
              onCeremonyComplete?.();
            }
          }}
          exit={{opacity:0,transition:{duration:reduced?0:.12}}}
          transition={{duration:reduced?0:ceremony?RITUAL_DURATION:4.2*(letterMotion.durationFactor||1),
            times:letterMotion.times||GLYPH_MOTION_TIMES,ease:letterMotion.ease||'easeInOut'}}> 
          {showCard?<img className="rune-effekseer-ceremony-card-image" src={cardSrc} alt={word+'符文卡面'}/>:
            <><RuneExtrudedGlyph word={word} profile={profile}/>
              {direction?<span className="rune-direction-stroke" aria-hidden="true">{word}</span>:null}</>}
        </motion.button>:null}
      </AnimatePresence>
      {!vfxOnly&&!ceremony&&visualReady&&semanticIcon?<motion.img key={'meaning-'+key} className="rune-effekseer-meaning-icon"
        src={semanticIcon} alt="" aria-hidden="true"
        initial={reduced?false:{opacity:0,scale:.8}}
        animate={reduced?{opacity:1,scale:1}:iconMotionFor(word)}
        transition={{duration:reduced?0:4.2,times:[0,.15,.78,1],ease:'easeInOut'}}/>:null}
      {!vfxOnly&&!ceremony&&visualReady?<SemanticIllustration key={'gesture-'+key} word={word} reduced={reduced}/>:null}
      <span className="rune-effekseer-english">{rune?.english_name||''}</span>
    </div>
    {!ceremony?<button type="button" className="rune-effekseer-replay" onClick={()=>setReplay(value=>value+1)}>重播文字與效果</button>:null}
    <span className="rune-effekseer-source" aria-hidden="true">{rune?.group_name||''}</span>
  </div>;
}
