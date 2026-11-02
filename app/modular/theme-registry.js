import {PUBLISHED_THEME_META} from './published-theme-meta.js';
export const THEME_TOKEN_KEYS=[
  '--loc-bg','--loc-panel','--loc-panel-2','--loc-panel-strong','--loc-panel-nav','--loc-panel-tab','--loc-rune-bg','--loc-rune-selected-bg',
  '--loc-line','--loc-line-soft','--loc-line-softer','--loc-line-faint','--loc-text','--loc-muted','--loc-heading','--loc-accent','--loc-gold','--loc-danger',
  '--loc-surface','--loc-surface-soft','--loc-surface-faint','--loc-surface-status','--loc-accent-surface','--loc-accent-surface-strong','--loc-accent-border','--loc-accent-border-soft','--loc-accent-border-faint',
  '--loc-gold-surface','--loc-gold-surface-soft','--loc-gold-border','--loc-gold-border-soft','--loc-gold-border-faint','--loc-gold-ring','--loc-gold-ring-soft','--loc-danger-border',
  '--loc-primary-start','--loc-primary-end','--loc-body-glow','--loc-body-mid','--loc-hero-start','--loc-hero-end','--loc-shadow','--loc-shadow-card'
];

const THEME_META=PUBLISHED_THEME_META;

export const THEME_SLOTS=Object.freeze(
  THEME_META.map(([id,label,scheme,styleKey],index)=>Object.freeze({id,label,scheme,styleKey,order:index+1}))
);

// Emergency fallback only. Canonical theme attributes are loaded from silver.loc.theme.
const EMERGENCY_THEME=Object.freeze({
  id:'theme-7',
  label:'秩序',
  scheme:'light',
  styleKey:'order',
  group:'秩序',
  identityColor:'#ffffff',
  tokens:Object.freeze({
    '--loc-bg':'#ffffff','--loc-panel':'#ffffff','--loc-panel-2':'#f7f7f7','--loc-panel-strong':'rgba(255,255,255,.98)','--loc-panel-nav':'rgba(255,255,255,.98)','--loc-panel-tab':'rgba(247,247,247,.98)','--loc-rune-bg':'#ffffff','--loc-rune-selected-bg':'#f1f1f1',
    '--loc-line':'rgba(30,30,30,.18)','--loc-line-soft':'rgba(30,30,30,.10)','--loc-line-softer':'rgba(30,30,30,.12)','--loc-line-faint':'rgba(30,30,30,.08)','--loc-text':'#202020','--loc-muted':'#666666','--loc-heading':'#111111','--loc-accent':'#555555','--loc-gold':'#666666','--loc-danger':'#a33f50',
    '--loc-surface':'rgba(255,255,255,.96)','--loc-surface-soft':'rgba(0,0,0,.035)','--loc-surface-faint':'rgba(0,0,0,.02)','--loc-surface-status':'rgba(0,0,0,.05)','--loc-accent-surface':'rgba(0,0,0,.06)','--loc-accent-surface-strong':'rgba(0,0,0,.12)','--loc-accent-border':'rgba(0,0,0,.35)','--loc-accent-border-soft':'rgba(0,0,0,.24)','--loc-accent-border-faint':'rgba(0,0,0,.16)',
    '--loc-gold-surface':'rgba(0,0,0,.06)','--loc-gold-surface-soft':'rgba(0,0,0,.035)','--loc-gold-border':'rgba(0,0,0,.35)','--loc-gold-border-soft':'rgba(0,0,0,.24)','--loc-gold-border-faint':'rgba(0,0,0,.16)','--loc-gold-ring':'rgba(0,0,0,.20)','--loc-gold-ring-soft':'rgba(0,0,0,.12)','--loc-danger-border':'rgba(163,63,80,.28)',
    '--loc-primary-start':'#ffffff','--loc-primary-end':'#f3f3f3','--loc-body-glow':'#ffffff','--loc-body-mid':'#fafafa','--loc-hero-start':'rgba(255,255,255,.99)','--loc-hero-end':'rgba(255,255,255,.99)','--loc-shadow':'0 20px 55px rgba(0,0,0,.10)','--loc-shadow-card':'0 12px 35px rgba(0,0,0,.06)'
  })
});

export function getThemeSlot(id){
  const meta=THEME_SLOTS.find(item=>item.id===id)||THEME_SLOTS.find(item=>item.id==='theme-7');
  return {
    ...EMERGENCY_THEME,
    id:meta?.id||EMERGENCY_THEME.id,
    label:meta?.label||EMERGENCY_THEME.label,
    scheme:meta?.scheme||EMERGENCY_THEME.scheme,
    styleKey:meta?.styleKey||EMERGENCY_THEME.styleKey,
    // Normal themes use CSS. Inline tokens exist only for authorized live previews.
    tokens:{}
  };
}

export function themeSignature(slot){
  if(!slot)return '';
  return [slot.id||'',slot.scheme||'',...THEME_TOKEN_KEYS.map(key=>String(slot.tokens?.[key]||''))].join('|');
}

export function applyTheme(slot){
  if(typeof document==='undefined'||!slot)return;
  const root=document.documentElement;
  THEME_TOKEN_KEYS.forEach(key=>root.style.removeProperty(key));
  root.dataset.theme=slot.scheme;
  root.dataset.themeId=slot.id;
  root.dataset.themeSignature=themeSignature(slot);
  delete root.dataset.themeBootstrap;
  root.style.colorScheme=slot.scheme;
  Object.entries(slot.tokens||{}).forEach(([key,value])=>{if(value)root.style.setProperty(key,value);});
}
