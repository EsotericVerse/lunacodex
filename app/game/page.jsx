// LOC Web redirects to sole LRS implementation; LOC iOS overlays original LRS page.
import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'月之符文桌遊｜本機牌局',
  description:'LunaRunes 本機桌遊牌桌：二至四人輪流出牌、歷史事件與共振回合。',
  path:'/game/',noIndex:true
});
export default function LrsWebRoute(){return <LrsWebRedirect path="/game"/>;}
