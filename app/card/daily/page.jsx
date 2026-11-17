// LOC Web redirects to sole LRS implementation; LOC iOS overlays original LRS page.
import LrsWebRedirect from '../../loc/views/LrsWebRedirect';
import {lunarunesMetadata} from '../../seo/metadata';
export const metadata=lunarunesMetadata({
  title:'每日符文 · 2D／3D｜月之符文',
  description:'每日符文同一入口選擇 2D 或 3D，保留當日真實月相與原有每日指引。',
  path:'/card/daily/'
});
export default function LrsWebRoute(){return <LrsWebRedirect path="/card/daily"/>;}
