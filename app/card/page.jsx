// LOC Web redirects to sole LRS implementation; LOC iOS overlays original LRS page.
import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'符文美術場域｜月之符文',
  description:'原創畫作構成的月光儀式：隨機抽牌、指定符文與每日指示。',
  path:'/card/',noIndex:true
});
export default function LrsWebRoute(){return <LrsWebRedirect path="/card"/>;}
