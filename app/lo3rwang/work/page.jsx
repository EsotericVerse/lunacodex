import AuthorHomeView from '../../loc/views/AuthorHomeView';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'工作與服務｜政德｜月典',
  description:'整理政德目前的工作方向、語言建築、治理與相關服務內容。',
  path:'/lo3rwang/work/'
});

export default function AuthorWorkPage(){
  return <AuthorHomeView section="work"/>;
}
