'use client';

import {PUBLISHED_THEME_META} from '../modular/published-theme-meta.js';
import {getThemeSlot,THEME_TOKEN_KEYS} from '../modular/theme-registry';

// CSS custom-property names are a fixed renderer contract.
// Public theme data comes from published JSON. silver.loc.theme is Admin-only
// authoring data and is never queried to render visitor or Scope pages.
export function themeColumnForToken(key){
  if(!THEME_TOKEN_KEYS.includes(key))throw new Error('Unknown Theme token: '+key);
  return key.slice(2).replaceAll('-','_');
}
export const THEME_DB_COLUMNS=[
  'theme_id','theme_name','theme_order','scheme','style_key','identity_color',
  ...THEME_TOKEN_KEYS.map(themeColumnForToken)
].join(',');

// The database key is a number (1..8). Legacy client Theme identifiers are
// presentation identifiers only, never stored in silver.loc.theme.
export function themeUiId(value){
  const id=String(value??'').trim();
  const number=/^theme-([1-8])$/.exec(id)?.[1]||(/^[1-8]$/.test(id)?id:'');
  return number?'theme-'+number:'';
}
export function themeNumber(value){
  const id=themeUiId(value);
  return id?Number(id.slice(6)):null;
}

// Lightweight 8-name index. It does not import eight complete palettes.
export async function selectThemeRegistry(){
  return PUBLISHED_THEME_META.map(([id,name,scheme,styleKey],index)=>({
    theme_id:id,theme_name:name,scheme,style_key:styleKey,theme_order:index+1
  }));
}

// Each JSON is a separate dynamic module. Only the active theme is imported;
// switching themes retires the previous palette from React state.
const PALETTE_LOADERS={
  'theme-1':()=>import('../modular/themes/theme-1.json'),
  'theme-2':()=>import('../modular/themes/theme-2.json'),
  'theme-3':()=>import('../modular/themes/theme-3.json'),
  'theme-4':()=>import('../modular/themes/theme-4.json'),
  'theme-5':()=>import('../modular/themes/theme-5.json'),
  'theme-6':()=>import('../modular/themes/theme-6.json'),
  'theme-7':()=>import('../modular/themes/theme-7.json'),
  'theme-8':()=>import('../modular/themes/theme-8.json')
};
export async function selectThemeOverride(themeId){
  const id=themeUiId(themeId);
  const load=PALETTE_LOADERS[id];
  if(!load)return null;
  const module=await load();
  const row=module.default||module;
  if(themeUiId(row?.theme_id)!==id)throw Error('Published theme identity mismatch: '+id);
  return {...row,theme_id:id};
}

export function mergeThemeSlot(themeId,override=null){
  const base=getThemeSlot(themeId);
  const tokens={...base.tokens};
  for(const key of THEME_TOKEN_KEYS){
    const column=themeColumnForToken(key);
    const value=String(override?.[column]??'').trim();
    if(value)tokens[key]=value;
  }
  return {
    ...base,
    id:String(override?.theme_id||base.id||themeId),
    label:String(override?.theme_name||base.label||themeId),
    scheme:override?.scheme==='dark'?'dark':override?.scheme==='light'?'light':base.scheme,
    styleKey:String(override?.style_key||base.styleKey||''),
    group:String(override?.theme_name||base.group||''),
    identityColor:String(override?.identity_color||base.identityColor||''),
    tokens,
    themeOrder:Number(override?.theme_order)||Number(String(themeId).split('-')[1])||0
  };
}


const clampChannel=value=>Math.max(0,Math.min(1,value));
export function normalizeThemeHex(value){
  const match=/^#?([0-9a-f]{6})$/i.exec(String(value||'').trim());
  return match?'#'+match[1].toLowerCase():'';
}

function themeRgb(hex){
  const value=normalizeThemeHex(hex);
  if(!value)return null;
  return [1,3,5].map(index=>parseInt(value.slice(index,index+2),16)/255);
}

function themeHsl(hex){
  const rgb=themeRgb(hex);
  if(!rgb)return null;
  const [r,g,b]=rgb;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  const lightness=(max+min)/2;
  let hue=0,saturation=0;
  if(delta){
    saturation=delta/(1-Math.abs(2*lightness-1));
    if(max===r)hue=((g-b)/delta)%6;
    else if(max===g)hue=(b-r)/delta+2;
    else hue=(r-g)/delta+4;
    hue=(hue*60+360)%360;
  }
  return {hue,saturation,lightness};
}

function themeHslHex(hue,saturation,lightness){
  const h=((hue%360)+360)%360/60;
  const s=clampChannel(saturation),l=clampChannel(lightness);
  const chroma=(1-Math.abs(2*l-1))*s;
  const x=chroma*(1-Math.abs(h%2-1));
  const m=l-chroma/2;
  const sector=Math.floor(h);
  const channels=sector===0?[chroma,x,0]:sector===1?[x,chroma,0]:sector===2?[0,chroma,x]:sector===3?[0,x,chroma]:sector===4?[x,0,chroma]:[chroma,0,x];
  return '#'+channels.map(channel=>Math.round((channel+m)*255).toString(16).padStart(2,'0')).join('');
}

function themeRgba(hex,alpha){
  const rgb=themeRgb(hex);
  if(!rgb)return '';
  return 'rgba('+rgb.map(channel=>Math.round(channel*255)).join(',')+','+clampChannel(alpha)+')';
}

/**
 * Generate the linked palette from the chosen identity color.
 * Danger colors remain semantic; text colors stay neutral for readability.
 */
export function deriveThemeTokens(identityColor,scheme='light',currentTokens={}){
  const source=normalizeThemeHex(identityColor);
  const base=themeHsl(source);
  if(!base)return null;
  const dark=scheme==='dark';
  const hue=base.hue;
  const saturation=base.saturation;
  const tone=(lightness,saturationScale=.16,toneHue=hue)=>
    themeHslHex(toneHue,saturation*saturationScale,lightness);
  const accent=themeHslHex(hue,saturation,dark?.72:.38);
  const goldHue=(hue+34)%360;
  const gold=themeHslHex(goldHue,saturation,dark?.76:.42);
  const bg=dark?tone(.055,.34):tone(.985,.12);
  const panel=dark?tone(.10,.30):tone(.998,.08);
  const panel2=dark?tone(.145,.32):tone(.955,.14);
  const text=tone(dark?.93:.18,.12);
  const heading=tone(dark?.98:.11,.08);
  const muted=tone(dark?.74:.43,.18);
  const selected=dark?tone(.24,.34):tone(.91,.22);
  const primaryStart=dark?tone(.40,.72):tone(.84,.78);
  const primaryEnd=dark?tone(.28,.68):tone(.73,.76);
  const neutralShadow=dark?'rgba(0,0,0,.34)':'rgba(15,22,32,.12)';
  const cardShadow=dark?'rgba(0,0,0,.28)':'rgba(15,22,32,.08)';
  const danger=currentTokens['--loc-danger']||(dark?'#ffb0b8':'#a33f50');
  const dangerBorder=currentTokens['--loc-danger-border']||(dark?'rgba(255,176,184,.32)':'rgba(163,63,80,.28)');

  return {
    '--loc-bg':bg,
    '--loc-panel':panel,
    '--loc-panel-2':panel2,
    '--loc-panel-strong':themeRgba(panel,.98),
    '--loc-panel-nav':themeRgba(panel,.97),
    '--loc-panel-tab':themeRgba(panel2,.98),
    '--loc-rune-bg':panel,
    '--loc-rune-selected-bg':selected,
    '--loc-line':themeRgba(accent,dark?.30:.24),
    '--loc-line-soft':themeRgba(accent,dark?.21:.15),
    '--loc-line-softer':themeRgba(accent,dark?.16:.11),
    '--loc-line-faint':themeRgba(accent,dark?.11:.075),
    '--loc-text':text,
    '--loc-muted':muted,
    '--loc-heading':heading,
    '--loc-accent':accent,
    '--loc-gold':gold,
    '--loc-danger':danger,
    '--loc-surface':themeRgba(panel,.96),
    '--loc-surface-soft':themeRgba(accent,dark?.11:.07),
    '--loc-surface-faint':themeRgba(accent,dark?.07:.04),
    '--loc-surface-status':themeRgba(accent,dark?.13:.08),
    '--loc-accent-surface':themeRgba(accent,dark?.18:.10),
    '--loc-accent-surface-strong':themeRgba(accent,dark?.27:.18),
    '--loc-accent-border':themeRgba(accent,dark?.56:.42),
    '--loc-accent-border-soft':themeRgba(accent,dark?.40:.29),
    '--loc-accent-border-faint':themeRgba(accent,dark?.26:.18),
    '--loc-gold-surface':themeRgba(gold,dark?.18:.10),
    '--loc-gold-surface-soft':themeRgba(gold,dark?.12:.065),
    '--loc-gold-border':themeRgba(gold,dark?.54:.40),
    '--loc-gold-border-soft':themeRgba(gold,dark?.38:.27),
    '--loc-gold-border-faint':themeRgba(gold,dark?.24:.16),
    '--loc-gold-ring':themeRgba(gold,dark?.34:.22),
    '--loc-gold-ring-soft':themeRgba(gold,dark?.22:.14),
    '--loc-danger-border':dangerBorder,
    '--loc-primary-start':primaryStart,
    '--loc-primary-end':primaryEnd,
    '--loc-body-glow':dark?tone(.17,.48):tone(.96,.24),
    '--loc-body-mid':dark?tone(.08,.30):tone(.985,.10),
    '--loc-hero-start':themeRgba(dark?tone(.12,.34):tone(.99,.08),.99),
    '--loc-hero-end':themeRgba(dark?tone(.075,.28):tone(.98,.10),.99),
    '--loc-shadow':'0 20px 55px '+neutralShadow,
    '--loc-shadow-card':'0 12px 35px '+cardShadow
  };
}
