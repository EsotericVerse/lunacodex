import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'文字與作品搜尋｜月典',
  description:'輸入關鍵字搜尋文字、作品、多媒體與符文內容，並沿來源與關係查看前後脈絡。',
  path:'/search/',
  noIndex:true
});

export default function SearchPage(){return <LocApp forcedView="search"/>;}
