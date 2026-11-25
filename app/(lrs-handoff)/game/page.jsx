import LrsWebRedirect from '../LrsWebRedirect';
import {lrsMetadata} from '../../seo/metadata';

export const metadata=lrsMetadata({
  title:'月之符文桌遊｜本機牌局',
  description:'LunaRunes 本機桌遊牌桌：二至四人輪流出牌、歷史事件與共振回合。',
  path:'/game/',noIndex:true
});
// LOC Web publishes only the link. LRS builds and serves the feature independently.
export default function GamePage(){
  return <LrsWebRedirect path="/game/"/>;
}
