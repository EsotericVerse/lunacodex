import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lrsMetadata} from '../../seo/metadata';
export const metadata=lrsMetadata({
  title:'每日符文 · 2D／3D｜月之符文',
  description:'每日符文同一入口選擇 2D 或 3D，保留當日真實月相與原有每日指引。',
  path:'/card/daily/'
});
// LOC Web publishes only the link. LRS builds and serves the feature independently.
export default function RuneCardDaily(){
  return <LrsWebRedirect path="/card/daily/"/>;
}
