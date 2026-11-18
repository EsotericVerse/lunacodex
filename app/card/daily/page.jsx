import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../../seo/metadata';
export const metadata=lunarunesMetadata({
  title:'每日符文 · 2D／3D｜月之符文',
  description:'每日符文同一入口選擇 2D 或 3D，保留當日真實月相與原有每日指引。',
  path:'/card/daily/'
});
// Only the Web card/game entry goes to the LRS standalone feature.
// The existing LOC native bundle continues to render the original component.
export default function RuneCardDaily(){
  return <LrsWebRedirect path="/card/daily/"/>;
}
