import {LUNARUNES_ORIGIN} from '../seo/metadata';

export const dynamic='force-static';

function url(path='/'){
  const clean='/' + String(path||'/').split('/').filter(Boolean).join('/');
  return LUNARUNES_ORIGIN+(clean==='/'?'/':clean+'/');
}

function xmlEscape(value){
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

export function GET(){
  const basePaths=[
    '/',
    '/statics',
    '/culture',
    '/trace',
    '/card',
    '/card/duel',
    '/card/daily',
    '/card/list',
    '/game',
    '/daily/log'
  ];
  const urls=basePaths.map(path=>url(path));
  const body='<?xml version="1.0" encoding="UTF-8"?>\n'
    +'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    +urls.map(item=>'  <url><loc>'+xmlEscape(item)+'</loc></url>').join('\n')
    +'\n</urlset>\n';
  return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8'}});
}
