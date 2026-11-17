// LOC Web redirects to sole LRS implementation; LOC iOS overlays original LRS page.
import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'符文抽牌 · 2D／3D｜月之符文',
  description:'在同一頁選擇 2D 原創美術或 3D 符文特效，沿用符韻的抽牌規則及指引籤詩。',
  path:'/card/duel/'
});
export default function LrsWebRoute(){return <LrsWebRedirect path="/card/duel"/>;}
