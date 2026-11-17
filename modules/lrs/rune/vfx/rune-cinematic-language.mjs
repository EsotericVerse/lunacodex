/**
 * LunaRunes stage-language configuration, not new rune semantics or VFX.
 * The 66 canonical authored effects stay unchanged. These nine presets
 * orchestrate only camera, playback transforms and supplementary AUTHORED
 * Effekseer .efkefc clips already in the pinned asset library.
 *
 * All durations refer to seconds since the individual rune materializes.
 * Two systems deliberately remain separate: divination's four orientations
 * and the visual atlas, which never displays an orientation.
 */
export const GROUP_STAGE_LANGUAGE=Object.freeze([
  {group:'靈魂',style:'gather',cameraX:.12,cameraY:.18,depthKick:.9,impact:'M:Holy1',impactScale:1.9,impactSpeed:1.35,impactColor:[210,224,255,195]},
  {group:'連結',style:'converge',cameraX:.36,cameraY:.04,depthKick:1.2,impact:'M:MagicArea',impactScale:2.1,impactSpeed:1.5,impactColor:[199,194,255,195]},
  {group:'生命',style:'rise',cameraX:.09,cameraY:.31,depthKick:1.0,impact:'T:Cure6',impactScale:2.1,impactSpeed:1.35,impactColor:[177,236,186,195]},
  {group:'自然',style:'drift',cameraX:.42,cameraY:.16,depthKick:1.1,impact:'M:Wind_Impact',impactScale:2.2,impactSpeed:1.6,impactColor:[165,218,205,190]},
  {group:'礦物',style:'weight',cameraX:.07,cameraY:.08,depthKick:1.6,impact:'M:Attack_Impact',impactScale:2.25,impactSpeed:1.55,impactColor:[231,207,165,215]},
  {group:'元素',style:'surge',cameraX:.26,cameraY:.22,depthKick:2.0,impact:'M:Wind_Impact',impactScale:2.5,impactSpeed:1.8,impactColor:[239,224,196,230]},
  {group:'秩序',style:'align',cameraX:.02,cameraY:.09,depthKick:1.0,impact:'SAMPLE:Simple_Ring_Shape2',impactScale:2.1,impactSpeed:1.5,impactColor:[211,218,255,188]},
  {group:'無序',style:'displace',cameraX:.29,cameraY:.24,depthKick:1.6,impact:'M:Attack_Impact',impactScale:2.3,impactSpeed:1.72,impactColor:[214,187,248,205]},
  {group:'特殊',style:'threshold',cameraX:.14,cameraY:.13,depthKick:1.8,impact:'T:Light3',impactScale:2.4,impactSpeed:1.35,impactColor:[239,219,250,205]}
]);
/** Nine distinct authored prelude effects. No shared MagicArea beam during Rune drawing. */
export const GROUP_SUMMON_EFFECTS=Object.freeze([
  {group:'靈魂',key:'M:Holy1',scale:2,speed:0.76},
  {group:'連結',key:'M:Magic1_wind',scale:1.95,speed:0.87},
  {group:'生命',key:'T:Cure6',scale:1.9,speed:0.78},
  {group:'自然',key:'M:Sylph5',scale:2.15,speed:0.7},
  {group:'礦物',key:'M:Rock2',scale:2.1,speed:0.8},
  {group:'元素',key:'M:Wind_Impact',scale:2.25,speed:0.92},
  {group:'秩序',key:'SAMPLE:Simple_Ring_Shape1',scale:2,speed:0.77},
  {group:'無序',key:'M:Breakdown',scale:2.05,speed:0.83},
  {group:'特殊',key:'T:Light3',scale:2.15,speed:0.69}
]);
export function groupSummonForRune(runeId){
  const n=Number(runeId);
  if(!Number.isInteger(n)||n<1||n>66)return null;
  return GROUP_SUMMON_EFFECTS[n<=64?Math.floor((n-1)/8):8];
}
export const GROUP_IMPACT_AT=0.62;
export const GROUP_IMPACT_LENGTH=.72;
export const CINEMATIC_CAMERA_BASE=24;
const clamp01=t=>Math.min(1,Math.max(0,t));
const ease=t=>{const n=clamp01(t);return n*n*(3-2*n);};
export function groupStageForRune(runeId){
  const n=Number(runeId);
  if(!Number.isInteger(n)||n<1||n>66)return null;
  return GROUP_STAGE_LANGUAGE[n<=64?Math.floor((n-1)/8):8];
}
export function cinematicCameraPose(seconds,group,zoom){
  const t=Math.max(0,seconds);
  if(!group)return {x:0,y:0,z:zoom};
  const arrival=ease((t-.10)/.9);
  const returnEase=1-ease((t-3.05)/1.35);
  const active=arrival*returnEase;
  const punch=Math.max(0,1-Math.abs(t-GROUP_IMPACT_AT)/.42);
  const sway=Math.sin(t*1.45);
  const flutter=group.style==='displace'?Math.sin(t*9)*.11:0;
  const x=active*(group.cameraX*(group.style==='align'?.1:sway)+flutter);
  const y=active*(group.style==='rise'?-group.cameraY*arrival:
    group.style==='weight'?group.cameraY*returnEase:
    group.cameraY*Math.cos(t*1.12));
  // A brief closer camera pass on an authored impact; z always returns to 24.
  const z=Math.max(8.6,zoom-group.depthKick*punch);
  return {x,y,z};
}
