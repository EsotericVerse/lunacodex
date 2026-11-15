'use client';

import {navigationHref} from '../modular/routing/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import ScopeLink from '../modular/ScopeLink';

export default function RuneArtNav(){
  const native=useNativeNavigation();
  return <nav className="runes-home-nav" aria-label="符文三大功能入口">
    <ScopeLink className="loc-button" href={navigationHref('lrunes','',native)} native={native}>← 回符文首頁</ScopeLink>
    <ScopeLink className="loc-button" href={navigationHref('lrunes','card/duel',native)} native={native}>抽牌 · 選擇 2D／3D</ScopeLink>
    <ScopeLink className="loc-button" href={navigationHref('lrunes','card/list',native)} native={native}>符文圖鑑 · 選擇 2D／3D</ScopeLink>
    <ScopeLink className="loc-button" href={navigationHref('lrunes','card/daily',native)} native={native}>每日符文 · 選擇 2D／3D</ScopeLink>
  </nav>;
}
