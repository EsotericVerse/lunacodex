import LocApp from '../loc/LocApp';
import JsonLd from '../seo/JsonLd';
import {authorMetadata,authorProfileJsonLd} from '../seo/metadata';

export const metadata=authorMetadata({
  title:'Lucas Oscar Wang 政德｜語言建築師',
  description:'Lucas Oscar Wang 政德的作者頁，整理創作、工作方向、語言建築，以及 LOC 與 LunaRunes 的公開介紹。',
  path:'/lo3rwang/'
});

export default function Lo3rwangScopePage(){
  return <><JsonLd data={authorProfileJsonLd()}/><LocApp forcedView="home" forcedScope="lo3rwang"/></>;
}
