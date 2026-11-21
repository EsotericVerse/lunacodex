import LocApp from './loc/LocApp';
import JsonLd from './seo/JsonLd';
import {locMetadata,locWebSiteJsonLd} from './seo/metadata';

export const metadata=locMetadata({
  title:'LOC 月典',
  description:'月典是一套語言建構框架工具，用來整理文字、作品與時間脈絡，並透過搜尋、統計與時間變化協助回看資料。',
  path:'/'
});

export default function HomePage(){
  return <><JsonLd data={locWebSiteJsonLd()}/><LocApp/></>;
}
