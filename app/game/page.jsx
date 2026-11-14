import GameBoard from '../lrunes/game/GameBoard';
import {lunarunesMetadata} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'月之符文桌遊｜本機牌局',
  description:'LunaRunes 本機桌遊牌桌：二至四人輪流出牌、歷史事件與共振回合。',
  path:'/game/',noIndex:true
});
export default function GamePage(){return <GameBoard/>;}
