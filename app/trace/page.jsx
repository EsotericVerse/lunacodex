import LocApp from '../loc/LocApp';
import {locMetadata} from '../seo/metadata';

export const metadata=locMetadata({
  title:'痕跡｜LOC 月典',
  description:'地理空間定錨與路線展示。',
  path:'/trace/'
});

export default function TracePage(){return <LocApp forcedView="trace"/>;}
 