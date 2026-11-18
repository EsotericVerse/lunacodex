import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'符文抽牌 · 2D／3D｜月之符文',
  description:'在同一頁選擇 2D 原創美術或 3D 符文特效，沿用符韻的抽牌規則及指引籤詩。',
  path:'/card/duel/'
});
// Only the Web card/game entry goes to the LRS standalone feature.
// The existing LOC native bundle continues to render the original component.
export default function RuneCardDuel(){
  return <LrsWebRedirect path="/card/duel/"/>;
}
