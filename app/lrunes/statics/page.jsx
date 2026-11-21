import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'資料統計與時間變化｜月之符文',
  description:'查看月之符文相關資料的數量、來源比例與時間變化。',
  path:'/statics/'
});

export default function Page(){return <LocApp forcedView="statics" forcedScope="lrunes"/>;}
