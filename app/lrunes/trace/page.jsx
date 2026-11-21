import LocApp from '../../loc/LocApp';
import {lunarunesMetadata} from '../../seo/metadata';

export const metadata=lunarunesMetadata({
  title:'痕跡｜月之符文',
  description:'地理空間定錨與路線展示。',
  path:'/trace/'
});

export default function TracePage(){return <LocApp forcedView="trace" forcedScope="lrunes"/>;}
 