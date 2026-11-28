import {PUBLISHED_THEME_META} from './published-theme-meta.js';
export const THEME_TOKEN_KEYS=[
  '--loc-bg',
  '--loc-panel',
  '--loc-panel-2',
  '--loc-line',
  '--loc-text',
  '--loc-muted',
  '--loc-heading',
  '--loc-accent',
  '--loc-gold',
  '--loc-danger'
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
    '--loc-bg':'#ffffff',
    '--loc-panel':'#ffffff',
    '--loc-panel-2':'#f7f7f7',
    '--loc-line':'rgba(30,30,30,.18)',
    '--loc-text':'#202020',
    '--loc-muted':'#666666',
    '--loc-heading':'#111111',
    '--loc-accent':'#555555',
    '--loc-gold':'#666666',
    '--loc-danger':'#a33f50'
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

// All published theme stylesheets are linked once in the document head.
export function publishedThemeCssHref(themeId){
  return THEME_SLOTS.some(slot=>slot.id===themeId)
    ?'/themes/'+themeId+'.css':null;
}
export function activatePublishedTheme(themeId){
  if(!publishedThemeCssHref(themeId)||typeof document==='undefined')
    return Promise.resolve(false);
  applyTheme(getThemeSlot(themeId));
  return Promise.resolve(true);
}
