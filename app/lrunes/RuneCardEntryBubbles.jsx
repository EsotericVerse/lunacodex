'use client';
import {navigationHref} from '../modular/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import ScopeLink from '../modular/ScopeLink';

const ENTRIES=Object.freeze([
  {title:'符文抽牌',description:'同一頁切換 2D 平面卡圖與最新 3D 特效，抽取 1 至 11 枚。',path:'card/duel'},
  {title:'每日符文',description:'單枚每日指示，可切換 2D／3D。',path:'card/daily'},
  {title:'符文圖鑑',description:'九組符文及 66 枚原創卡面，可切換 2D／3D。',path:'card/list'}
]);
export default function RuneCardEntryBubbles(){
  const native=useNativeNavigation();
  return <div className="home-draw-bubbles" aria-label="符文正式入口">
    {ENTRIES.map(entry=><ScopeLink className="loc-bubble" key={entry.path}
      href={navigationHref('lrunes',entry.path,native)} native={native}>
      <strong>{entry.title}</strong><p>{entry.description}</p>
    </ScopeLink>)}
  </div>;
}
