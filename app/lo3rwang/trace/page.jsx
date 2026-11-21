import LocApp from '../../loc/LocApp';
import {authorMetadata} from '../../seo/metadata';

export const metadata=authorMetadata({
  title:'痕跡｜Lucas Oscar Wang 政德',
  description:'地理空間定錨與路線展示。',
  path:'/lo3rwang/trace/'
});

export default function TracePage(){return <LocApp forcedView="trace" forcedScope="lo3rwang"/>;}
 