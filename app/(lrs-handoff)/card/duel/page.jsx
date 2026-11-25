import LrsWebRedirect from '../../LrsWebRedirect';
import {lrsMetadata} from '../../../seo/metadata';

export const metadata=lrsMetadata({
  title:'符文抽牌 · 2D／3D｜月之符文',
  description:'在同一頁選擇 2D 原創美術或 3D 符文特效，沿用符韻的抽牌規則及指引籤詩。',
  path:'/card/duel/'
});
// LOC Web publishes only the link. LRS builds and serves the feature independently.
export default function RuneCardDuel(){
  return <LrsWebRedirect path="/card/duel/"/>;
}
