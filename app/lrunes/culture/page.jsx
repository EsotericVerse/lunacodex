import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'時間長河與文化軌跡｜月之符文',
  description:'把月之符文相關紀錄放回時間順序，觀察不同時期的累積、來源與變化。',
  path:'/culture/'
});

export default function Page(){return <LocApp forcedView="culture" forcedScope="lrunes"/>;}
