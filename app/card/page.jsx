import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import {lrsMetadata} from '../seo/metadata';

export const metadata=lrsMetadata({
  title:'符文美術場域｜月之符文',
  description:'原創畫作構成的月光儀式：隨機抽牌、指定符文與每日指示。',
  path:'/card/',noIndex:true
});

// LOC Web publishes only the link. LRS builds and serves the feature independently.
export default function RuneCardPage(){
  return <LrsWebRedirect path="/card/"/>;
}
