import {LOC_ORIGIN} from './seo/metadata';

export const dynamic='force-static';

function url(path='/'){
  const clean='/' + String(path||'/').split('/').filter(Boolean).join('/');
  return LOC_ORIGIN+(clean==='/'?'/':clean+'/');
}

export default function sitemap(){
  return [
    '/',
    '/statics',
    '/culture',
    '/trace',
    '/lo3rwang',
    '/lo3rwang/work',
    '/lo3rwang/statics',
    '/lo3rwang/culture',
    '/lo3rwang/trace'
  ].map(path=>({url:url(path)}));
}
