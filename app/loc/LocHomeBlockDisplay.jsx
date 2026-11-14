'use client';

import {SITE_IMAGES} from '../site-images';
import {HomeBlock} from './home-block-model';

import {BlockNoteContent} from './blocknote-content.mjs';

// Existing, approved site images only. New text frames have no image by default;
// images are not uploaded to, or stored by, the block editor.
const LOC_MEDIA=Object.freeze({
  2:{src:SITE_IMAGES.lunarunes,alt:'LunaRunes 月之符文',position:'right',width:'420px'},
  3:{src:SITE_IMAGES.locArchitecture,alt:'LOC 月典文化與架構示意圖',position:'left',width:'540px'},
  5:{src:SITE_IMAGES.author,alt:'作者 Lucas Oscar Wang 政德',position:'right',width:'360px'}
});
const AUTHOR_MEDIA=Object.freeze({
  5:{src:{src:'/pics/lo3rwang-3.webp'},alt:'政德、玄鑒與符韻的三魂關係圖',position:'right',width:'420px'}
});

const RUNES_MEDIA=Object.freeze({});

function imageFor(slot,scopeId='loc'){
  const assets=scopeId==='lo3rwang'?AUTHOR_MEDIA:scopeId==='lrunes'?RUNES_MEDIA:LOC_MEDIA;
  return assets[Number(slot?.order)||0]||null;
}

export function resolveHomeImage(slot,scopeId='loc'){
  const preset=imageFor(slot,scopeId);
  const config=slot?.image&&typeof slot.image==='object'?slot.image:null;
  const embedded=BlockNoteContent.image.firstFrameImageUrl(slot);
  const picked=['default','custom','none'].includes(config?.source)
    ?config.source:(embedded?'custom':preset?'default':'none');
  const source=picked;
  const customUrl=BlockNoteContent.image.normalizeImageSource(config?.url||embedded);
  const src=source==='none'?'':source==='default'?preset?.src?.src||'':customUrl;
  const position=Number(slot?.order)===1?'right':['left','right','top','bottom','only'].includes(config?.position)
    ?config.position:(preset?.position||'right');
  const width=Number.isFinite(Number(config?.width))&&Number(config?.width)>=160&&Number(config?.width)<=800
    ?Math.round(Number(config.width)):parseInt(preset?.width,10)||420;
  const mode=config?.mode==='side'||config?.mode==='background'?config.mode:BlockNoteContent.image.heroImageMode(slot);
  return {src,source,position,width,mode,preset,embedded,customUrl,
    alt:source==='default'?preset?.alt||'框架圖片':'框架圖片',
    small:source==='default'?preset?.small:null};
}

export function locHomeBlockClass(slot,scopeId='loc'){
  const order=Number(slot?.order)||0;
  const image=resolveHomeImage(slot,scopeId);
  return [
    order===1?'loc-hero loc-home-hero':'loc-card',
    'loc-home-block',
    scopeId==='loc'&&order===3?'loc-home-block--architecture':'',
    order===1?'loc-home-block--hero':'',
    order!==1&&image.src?(image.position==='only'?'loc-home-block--image-only':'loc-home-block--with-image loc-home-block--image-'+image.position):'',
    order!==1&&image.src&&['left','right'].includes(image.position)&&
      Number.isFinite(Number(slot?.image?.width))&&Number(slot.image.width)>=160&&Number(slot.image.width)<=800
      ?'loc-home-block--media-sized':''
  ].filter(Boolean).join(' ');
}

// The frame owns the width value so CSS Grid can allocate a real media
// column. A width set only on the child image cannot resize its grid track.
export function homeBlockMediaStyle(slot,scopeId='loc'){
  const image=resolveHomeImage(slot,scopeId);
  return image.src&&Number(slot?.order)!==1
    ?{'--loc-home-media-max':image.width+'px'}
    :undefined;
}

function RichHtml({html,className='',stripImage=false}){
  const content=HomeBlock.stripLocHomeEditorPlaceholders(stripImage?BlockNoteContent.image.stripHeroImageTag(html):html||'');
  return content.trim()?<div className={className} dangerouslySetInnerHTML={{__html:content}}/>:null;
}

function SharedHomeBlockDisplay(slot,scopeId='loc'){
  const hero=Number(slot?.order)===1;
  const sign=hero?HomeBlock.heroExtraFor(scopeId):null;
  const image=resolveHomeImage(slot,scopeId);
  const imageOnly=!hero&&Boolean(image.src)&&image.position==='only';
  const children=HomeBlock.visibleEntities(slot).filter(entity=>entity.title||
    BlockNoteContent.image.stripHeroImageTag(entity.text).replace(/<[^>]*>/g,'').trim());
  const Heading=hero?'h1':'h2';
  const header=<header className="loc-home-block__header">
    {slot.eyebrow?<p className="loc-eyebrow">{slot.eyebrow}</p>:null}
    {slot.title?<Heading>{slot.title}</Heading>:null}
    {slot.subtitle?<p className="loc-subtitle loc-home-block__subtitle">{HomeBlock.plainBlockLine(slot.subtitle)}</p>:null}
  </header>;
  const body=<RichHtml html={slot.text} stripImage className="loc-home-block__body"/>;
  const media=image.src?(hero?<figure className="loc-home-block__media home-hero-visual" aria-label={image.alt}>
    <picture>{image.small?<source media="(max-width: 760px)" srcSet={image.small.src}/>:null}
      <img src={image.src} alt="" aria-hidden="true" loading="eager" fetchPriority="high" decoding="async"/></picture>
  </figure>:<article className="loc-home-block__media loc-home-block__media-bubble loc-bubble"
    style={{'--loc-home-media-max':image.width+'px'}}>
    <img src={image.src} alt={image.alt} loading="lazy" decoding="async"/>
  </article>):null;
  return <>
    {header}
    {imageOnly?<div className="loc-home-block__body loc-home-block__body--image"
      style={{'--loc-home-media-max':image.width+'px'}}>
      <img src={image.src} alt={image.alt} loading="lazy" decoding="async"/>
    </div>:body}
    {children.length?<div className="loc-home-block__children" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([slot.bubbleColumns],slot.pageName||'index')}}>
      {children.map((entity,index)=>{
        const card=HomeBlock.childPresentation(entity.title)==='card';
        return <article className={'loc-home-block__child '+(card?'loc-home-block__child--card':'loc-home-block__child--bubble')}
          key={entity.uid||'child-'+index}>
          {card?<h3>{entity.title}</h3>:null}
          <RichHtml html={entity.text} stripImage className="loc-home-block__child-copy"/>
        </article>;
      })}
    </div>:null}
    {!imageOnly?media:null}
    {sign?<span className={'home-hero-identity home-hero-identity--'+sign.key}
      role="img" aria-label={sign.label}>{sign.text}</span>:null}
  </>;
}

/* LOC and Author use exactly the same home frame renderer and DOM hierarchy.
   Only preset images, block contents and scope editing permissions differ. */
export default function LocHomeBlockDisplay(slot){
  return SharedHomeBlockDisplay(slot,'loc');
}

export function RunesHomeBlockDisplay(slot){
  return SharedHomeBlockDisplay(slot,'lrunes');
}

export function AuthorHomeBlockDisplay(slot){
  return SharedHomeBlockDisplay(slot,'lo3rwang');
}

export function authorHomeBlockClass(slot){
  return locHomeBlockClass(slot,'lo3rwang');
}

