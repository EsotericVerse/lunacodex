/** @jsxImportSource preact */
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {PUBLISHED_THEME_META} from '../modular/published-theme-meta.js';

const PREF_KEY='loc-user-theme-selection-v1';
const options=PUBLISHED_THEME_META;
const schemes=Object.fromEntries(options.map(row=>[row[0],row[2]]));

function selected(scopeId){
  try{
    const value=JSON.parse(sessionStorage.getItem(PREF_KEY)||'{}')[scopeId];
    const id=/^[1-8]$/.test(String(value??''))?'theme-'+value:String(value||'');
    return Object.hasOwn(schemes,id)?id:'system-default';
  }catch{return 'system-default';}
}
function changeTheme(scopeId,id){
  try{
    const saved=JSON.parse(sessionStorage.getItem(PREF_KEY)||'{}');
    if(id==='system-default')delete saved[scopeId];
    else saved[scopeId]=Number(id.replace('theme-',''));
    sessionStorage.setItem(PREF_KEY,JSON.stringify(saved));
  }catch{}
  if(id==='system-default'){
    window.location.reload();
    return;
  }
  const root=document.documentElement;
  root.dataset.themeId=id;
  root.dataset.theme=schemes[id]||'light';
  root.style.colorScheme=schemes[id]||'light';
  const sheet=document.getElementById('loc-theme-stylesheet');
  if(sheet){sheet.href='/themes/'+id+'.css';sheet.dataset.themeId=id;}
}
function Preferences({scopeId,onOpenFull,onClose}){
  const [theme,setTheme]=useState(()=>selected(scopeId));
  return <section class="loc-public-preferences" aria-label="外觀與語系設定">
    <label class="scope-theme-control"><span>主題</span>
      <select value={theme} onChange={event=>{
        const next=event.currentTarget.value;
        setTheme(next);
        changeTheme(scopeId,next);
      }} aria-label="主題">
        <option value="system-default">系統預設</option>
        {options.map(row=><option key={row[0]} value={row[0]}>{row[1]}</option>)}
      </select>
    </label>
    <button class="loc-button" type="button" onClick={onOpenFull}>
      語系與進階設定
    </button>
    <button class="loc-button" type="button" onClick={onClose} aria-label="關閉設定">關閉</button>
  </section>;
}
export function mountPublicPreferences(container,{scopeId,onOpenFull}){
  const close=()=>render(null,container);
  render(<Preferences scopeId={scopeId} onOpenFull={onOpenFull} onClose={close}/>,container);
  return close;
}
