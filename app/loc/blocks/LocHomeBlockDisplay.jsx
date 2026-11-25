'use client';

import {HomeBlock} from './home-block-model';

import {BlockNoteContent} from '../editor/blocknote-content.mjs';

export function resolveHomeImage(slot,scopeId='loc'){
  const config=slot?.image&&typeof slot.image==='object'?slot.image:null;
  const embedded=BlockNoteContent.image.firstFrameImageUrl(slot);
  const customUrl=BlockNoteContent.image.normalizeImageSource(config?.url||embedded);
  const source=config?.source==='none'?'none':customUrl?'custom':'none';
  const src=source==='custom'&&scopeId==='lrunes'&&/^https?:\/\/loc\.lo3rwang\.cc\/pics\/LunaRunes-hero\.jpg$/i.test(customUrl)
    ?'/pics/LunaRunes-hero.jpg':source==='custom'?customUrl:'';
  const position=Number(slot?.order)===1?'right':
    ['left','right','top','bottom','only'].includes(config?.position)?config.position:'right';
  const width=Number.isFinite(Number(config?.width))&&Number(config?.width)>=160&&Number(config?.width)<=800
    ?Math.round(Number(config.width)):420;
  const mode=config?.mode==='side'||config?.mode==='background'?config.mode:BlockNoteContent.image.heroImageMode(slot);
  return {src,source,position,width,mode,preset:null,embedded,customUrl,alt:'框架圖片',small:null};
}

export function locHomeBlockClass(slot,scopeId='loc'){
  const order=Number(slot?.order)||0;
  const image=resolveHomeImage(slot,scopeId);
  return [
    order===1?'loc-hero loc-home-hero':'loc-card',
    'loc-home-block',
    scopeId==='loc'&&order===3?'loc-home-block--architecture':'',
    order===1?'loc-home-block--hero':'',
    order===1&&scopeId==='lrunes'&&image.src&&image.mode==='side'?'loc-home-block--hero-side':'',
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

function RichHtml({html,className='',stripImage=false,scopeId='loc'}){
  const base=HomeBlock.stripLocHomeEditorPlaceholders(stripImage?BlockNoteContent.image.stripHeroImageTag(html):html||'');
  const content=base;
  return content.trim()?<div className={className} dangerouslySetInnerHTML={{__html:content}}/>:null;
}

function revealHomeImage(event){
  event.currentTarget.dataset.homeMediaReady='true';
}
function revealCachedHomeImage(node){
  if(node?.complete&&node.naturalWidth>0)node.dataset.homeMediaReady='true';
}

function SharedHomeBlockDisplay(slot,scopeId='loc'){
  const hero=Number(slot?.order)===1;
  const image=resolveHomeImage(slot,scopeId);
  const imageOnly=!hero&&Boolean(image.src)&&image.position==='only';
  const children=HomeBlock.visibleEntities(slot).filter(entity=>entity.title||
    BlockNoteContent.image.stripHeroImageTag(entity.text).replace(/<[^>]*>/g,'').trim());
  const Heading=hero?'h1':'h2';
  const header=<header key="header" className="loc-home-block__header">
    {slot.eyebrow?<p className="loc-eyebrow">{slot.eyebrow}</p>:null}
    {slot.title?<Heading>{slot.title}</Heading>:null}
    {slot.subtitle?<p className="loc-subtitle loc-home-block__subtitle">{HomeBlock.plainBlockLine(slot.subtitle)}</p>:null}
  </header>;
  const body=<RichHtml key="body" html={slot.text} stripImage scopeId={scopeId} className="loc-home-block__body"/>;
  const media=image.src?(hero?<figure key="media" className="loc-home-block__media home-hero-visual" aria-label={image.alt}>
    <picture>{image.small?<source media="(max-width: 760px)" srcSet={image.small.src}/>:null}
      <img key={image.src} src={image.src} alt="" aria-hidden="true" loading="eager" fetchPriority="high" decoding="async"
        ref={revealCachedHomeImage} onLoad={revealHomeImage}/></picture>
  </figure>:<article key="media" className="loc-home-block__media loc-home-block__media-bubble loc-bubble"
    style={{'--loc-home-media-max':image.width+'px'}}>
    <img key={image.src} src={image.src} alt={image.alt} loading="lazy" decoding="async"
      ref={revealCachedHomeImage} onLoad={revealHomeImage}/>
  </article>):null;
  return <>
    {header}
    {imageOnly?<div key="body" className="loc-home-block__body loc-home-block__body--image"
      style={{'--loc-home-media-max':image.width+'px'}}>
      <img key={image.src} src={image.src} alt={image.alt} loading="lazy" decoding="async"
      ref={revealCachedHomeImage} onLoad={revealHomeImage}/>
    </div>:body}
    {children.length?<div key="children" className="loc-home-block__children" style={{'--loc-bubble-columns':HomeBlock.bubbleColumns([slot.bubbleColumns],slot.pageName||'index')}}>
      {children.map((entity,index)=>{
        const card=HomeBlock.childPresentation(entity.title)==='card';
        return <article className={'loc-home-block__child '+(card?'loc-home-block__child--card':'loc-home-block__child--bubble')}
          key={entity.uid||'child-'+index}>
          {card?<h3>{entity.title}</h3>:null}
          <RichHtml html={entity.text} stripImage scopeId={scopeId} className="loc-home-block__child-copy"/>
        </article>;
      })}
    </div>:null}
    {!imageOnly?media:null}
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

