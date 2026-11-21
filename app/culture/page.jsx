import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'時間長河與文化軌跡｜月典',
  description:'把作品與紀錄放回時間順序，透過時間長河、定錨點與來源分布觀察不同時期的累積與變化。',
  path:'/culture/'
});

export default function CulturePage(){return <LocApp forcedView="culture"/>;}
