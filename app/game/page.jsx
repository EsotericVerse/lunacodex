import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import GameBoard from '../../modules/lrs/boardgame/GameBoard.jsx';
import {lunarunesMetadata} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'月之符文桌遊｜本機牌局',
  description:'LunaRunes 本機桌遊牌桌：二至四人輪流出牌、歷史事件與共振回合。',
  path:'/game/',noIndex:true
});
// Only the Web card/game entry goes to the LRS standalone feature.
// The existing LOC native bundle continues to render the original component.
export default function GamePage(){
  return process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'
    ?<GameBoard/>
    :<LrsWebRedirect path="/game/"/>;
}
