import {SITE_IMAGES} from '../site-images';
import {faviconForScope} from '../site-favicons';
import {LOC_SERVICE_ORIGINS} from '../modular/routing/service-route-index.mjs';

export const LOC_ORIGIN='https://loc.lo3rwang.cc';
export const LUNARUNES_ORIGIN='https://lrunes.lo3rwang.cc';
export const LRS_ORIGIN=LOC_SERVICE_ORIGINS.lrs;

const LOC_IMAGE=LOC_ORIGIN+SITE_IMAGES.locHero.src;
const LUNARUNES_IMAGE=LUNARUNES_ORIGIN+SITE_IMAGES.lunarunes.src;
const AUTHOR_IMAGE=LOC_ORIGIN+SITE_IMAGES.author.src;

function cleanPath(path='/'){
  const value='/' + String(path||'/').split('?')[0].split('#')[0].split('/').filter(Boolean).join('/');
  return value==='/'?'/':value+'/';
}
function urlFor(origin,path='/'){
  return origin.replace(/\/$/,'')+cleanPath(path);
}
function robotsFor(noIndex=false){
  if(!noIndex)return undefined;
  return {
    index:false,
    follow:true,
    googleBot:{index:false,follow:true}
  };
}
function pageMetadata({
  origin,
  path='/',
  siteName,
  title,
  description,
  image,
  imageAlt,
  faviconScope='loc',
  noIndex=false
}){
  const canonical=urlFor(origin,path);
  return {
    title,
    description,
    icons:{icon:[{url:faviconForScope(faviconScope)}]},
    alternates:{canonical},
    openGraph:{
      title,
      description,
      url:canonical,
      siteName,
      locale:'zh_TW',
      type:'website',
      images:[{url:image,alt:imageAlt}]
    },
    twitter:{
      card:'summary_large_image',
      title,
      description,
      images:[image]
    },
    ...(noIndex?{robots:robotsFor(true)}:{})
  };
}

export function locMetadata({title,description,path='/',noIndex=false,image=LOC_IMAGE,imageAlt='LOC 月典'}){
  return pageMetadata({
    origin:LOC_ORIGIN,path,siteName:'LOC 月典',title,description,
    image,imageAlt,noIndex
  });
}

export function lunarunesMetadata({title,description,path='/',noIndex=false,image=LUNARUNES_IMAGE,imageAlt='月之符文'}){
  return pageMetadata({
    origin:LUNARUNES_ORIGIN,path,siteName:'月之符文',title,description,
    image,imageAlt,noIndex,faviconScope:'lrunes'
  });
}

// Game, card and daily features are served by the separate LRS deployment.
// lrunes.lo3rwang.cc remains the LOC Scope origin and is not replaced here.
export function lrsMetadata({title,description,path='/',noIndex=true}){
  return pageMetadata({
    origin:LRS_ORIGIN,path,siteName:'LunaRunes 遊戲',title,description,
    image:LUNARUNES_IMAGE,imageAlt:'LunaRunes',noIndex,faviconScope:'lrunes'
  });
}

export function authorMetadata({title,description,path='/lo3rwang/',noIndex=false}){
  return pageMetadata({
    origin:LOC_ORIGIN,path,siteName:'Lucas Oscar Wang 政德',title,description,
    image:AUTHOR_IMAGE,imageAlt:'Lucas Oscar Wang 政德',noIndex,faviconScope:'lo3rwang'
  });
}

export function locWebSiteJsonLd(){
  return {
    '@context':'https://schema.org',
    '@type':'WebSite',
    name:'LOC 月典',
    alternateName:['月典','LOC','loc.lo3rwang.cc'],
    url:LOC_ORIGIN+'/'
  };
}

export function lunarunesWebSiteJsonLd(){
  return {
    '@context':'https://schema.org',
    '@type':'WebSite',
    name:'月之符文',
    alternateName:['LunaRunes','lrunes.lo3rwang.cc'],
    url:LUNARUNES_ORIGIN+'/'
  };
}

export function authorProfileJsonLd(){
  return {
    '@context':'https://schema.org',
    '@type':'ProfilePage',
    url:LOC_ORIGIN+'/lo3rwang/',
    mainEntity:{
      '@type':'Person',
      '@id':LOC_ORIGIN+'/lo3rwang/#author',
      name:'Lucas Oscar Wang 政德',
      alternateName:['政德','Oscar','lo3rwang'],
      description:'語言建築師，LOC 月典與月之符文作者。',
      url:LOC_ORIGIN+'/lo3rwang/',
      image:AUTHOR_IMAGE
    }
  };
}
