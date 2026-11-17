import RuneUnifiedView from '../../lrunes/RuneUnifiedView';
import {lunarunesMetadata} from '../../seo/metadata';
export const metadata=lunarunesMetadata({
  title:'每日符文 · 2D／3D｜月之符文',
  description:'每日符文同一入口選擇 2D 或 3D，保留當日真實月相與原有每日指引。',
  path:'/card/daily/'
});
export default function RuneCardDaily(){return <RuneUnifiedView feature="daily" defaultView="3d"/>;}
