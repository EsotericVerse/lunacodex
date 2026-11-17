import LrsWebRedirect from '../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../seo/metadata';
import RuneArtNav from '../lrunes/Rune3DNav';
import RuneCardHub from '../lrunes/RuneCardHub';

export const metadata=lunarunesMetadata({
  title:'符文美術場域｜月之符文',
  description:'原創畫作構成的月光儀式：隨機抽牌、指定符文與每日指示。',
  path:'/card/',noIndex:true
});

// Only the Web card/game entry goes to the LRS standalone feature.
// The existing LOC native bundle continues to render the original component.
export default function RuneCardPage(){
  return process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'
    ?<RuneCardHub Navigation={RuneArtNav}/>
    :<LrsWebRedirect path="/card/"/>;
}
