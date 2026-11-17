/** Nine semantic card-flight rhythms. The rune manifestation VFX remains Effekseer-owned. */
const PATHS=Object.freeze({
  // x/y are ratios of the stage measured once when a draw starts.
  '靈魂':{name:'浮現',times:[0,0.27,0.77,1],z:[0,85,48,0],pitch:[18,-17,-7,0],duration:1.3,x:[-.26,-.2,-.05,0],y:[.18,-.09,-.12,0],scale:[.78,.9,1.13,1.46],flip:[0,24,88,180],tilt:[-14,-12,-4,0]},
  '連結':{name:'牽引',times:[0,0.14,0.62,1],z:[0,10,95,0],pitch:[12,4,-24,0],duration:1.06,x:[-.26,-.12,.06,0],y:[.18,.02,-.02,0],scale:[.8,1,1.54,1.46],flip:[0,70,152,180],tilt:[-14,2,7,0]},
  '生命':{name:'脈動',times:[0,0.35,0.55,1],z:[0,95,10,0],pitch:[16,-9,12,0],duration:1.24,x:[-.26,-.19,-.09,0],y:[.18,.08,-.03,0],scale:[.74,1.11,.97,1.46],flip:[0,62,120,180],tilt:[-14,-4,4,0]},
  '自然':{name:'生長',times:[0,0.42,0.73,1],z:[0,18,72,0],pitch:[25,15,-13,0],duration:1.4,x:[-.26,-.24,-.11,0],y:[.18,.14,-.08,0],scale:[.74,.86,1.16,1.46],flip:[0,20,85,180],tilt:[-14,-12,-7,0]},
  '礦物':{name:'承重',times:[0,0.23,0.84,1],z:[0,-75,-15,0],pitch:[32,19,-7,0],duration:1.19,x:[-.26,-.21,-.04,0],y:[.18,.04,.10,0],scale:[.85,1.11,1.3,1.46],flip:[0,50,155,180],tilt:[-14,-2,-1,0]},
  '元素':{name:'激發',times:[0,0.12,0.36,1],z:[0,145,120,0],pitch:[20,-27,19,0],duration:.88,x:[-.26,-.07,.05,0],y:[.18,-.14,-.05,0],scale:[.8,1.27,1.66,1.46],flip:[0,105,160,180],tilt:[-14,13,-9,0]},
  '秩序':{name:'校準',times:[0,0.34,0.68,1],z:[0,25,25,0],pitch:[0,0,0,0],duration:1.1,x:[-.26,-.16,-.06,0],y:[.18,.1,.04,0],scale:[.82,1,1.27,1.46],flip:[0,60,120,180],tilt:[-14,-8,0,0]},
  '無序':{name:'游移',times:[0,0.18,0.5,1],z:[0,112,-55,0],pitch:[16,-30,29,0],duration:1.23,x:[-.26,-.06,-.23,0],y:[.18,-.10,.02,0],scale:[.8,1.25,.87,1.46],flip:[0,145,25,180],tilt:[-14,22,-23,0]},
  '特殊':{name:'異相',times:[0,0.27,0.76,1],z:[0,135,180,0],pitch:[-21,33,-26,0],duration:1.55,x:[-.26,-.04,.09,0],y:[.18,-.18,-.11,0],scale:[.81,1.19,1.55,1.46],flip:[0,165,290,540],tilt:[-14,-6,14,0]}
});
const DIRECTIONS=Object.freeze([0,90,-90,180]);
// Some groups manifest from moonlight; others physically draw from the deck.
// This is presentation only: game probability, orientation and Rune identity are unchanged.
const MOON_ORIGIN_GROUPS=new Set(['靈魂','生命','自然','元素','無序','特殊']);
const ORBIT_GLYPHS=Object.freeze({
  '靈魂':['靈','魂','憶','鏡'],
  '連結':['向','斷','封','鍊'],
  '生命':['生','心','愛','語'],
  '自然':['樹','花','根','種'],
  '礦物':['金','玉','晶','石'],
  '元素':['光','水','火','雷'],
  '秩序':['日','月','星','時'],
  '無序':['福','禍','夢','幻'],
  '特殊':['玄','命','玄','命']
});
export function runeDrawOrbitGlyphs(group){return ORBIT_GLYPHS[group]||[];}
export function runeDrawAppearance(group){return MOON_ORIGIN_GROUPS.has(group)?'moon':'deck';}
const GROUPS=Object.freeze(['靈魂','連結','生命','自然','礦物','元素','秩序','無序','特殊']);

/** Respect the canonical eight groups of eight, plus rune 65/66. */
export function runeDrawGroup(rune){
  const id=Number(rune?.rune_id);
  if(Number.isInteger(id)&&id>=1&&id<=64)return GROUPS[Math.floor((id-1)/8)];
  if(id===65||id===66)return '特殊';
  const group=String(rune?.group_name||'');
  return Object.hasOwn(PATHS,group)?group:'特殊';
}

/** Variations are deterministic per rune, never gameplay randomness. */
export function runeDrawMotion(group,directionIndex,{width=800,height=520}={},reduced=false,runeId=null){
  const path=PATHS[group]||PATHS['特殊'];
  const direction=DIRECTIONS[directionIndex]??0;
  const appearance=runeDrawAppearance(group);
  if(reduced){
    return {
      name:path.name,appearance,
      initial:{opacity:0,x:0,y:0,z:0,scale:1,rotateX:0,rotateY:180,rotateZ:direction},
      animate:{opacity:1,x:0,y:0,z:0,scale:1,rotateX:0,rotateY:180,rotateZ:direction},
      transition:{duration:.05}
    };
  }
  const id=Number(runeId);
  const variation=Number.isInteger(id)&&id>=1&&id<=66?((id-1)%8-3.5):0;
  const moon=appearance==='moon';
  const x=path.x.map((n,i)=>Math.round((moon?([.23,.15+path.x[1]*.19,.055+path.x[2]*.17,0][i]):n)
    *width+(i===1?variation*.006*width:0)));
  const y=path.y.map((n,i)=>Math.round((moon?([-.23,-.15+path.y[1]*.25,-.04+path.y[2]*.24,0][i]):n)
    *height+(i===2?variation*.005*height:0)));
  const scale=moon?[.18,Math.max(.55,path.scale[1]*.72),path.scale[2],path.scale[3]]:path.scale;
  const flip=moon?[180,220+path.flip[1]*.2,180+path.flip[2]*.09,path.flip[3]]:path.flip;
  const rotateZ=[...path.tilt.slice(0,-1),direction];
  return {
    name:path.name,appearance,
    initial:{opacity:0,x:x[0],y:y[0],z:path.z[0],scale:scale[0],rotateX:path.pitch[0],rotateY:flip[0],rotateZ:rotateZ[0]},
    animate:{opacity:[0,1,1,1],x,y,z:path.z,scale,rotateX:path.pitch,rotateY:flip,rotateZ},
    transition:{duration:Math.max(.75,path.duration+variation*.012),times:path.times,ease:'easeInOut'}
  };
}
