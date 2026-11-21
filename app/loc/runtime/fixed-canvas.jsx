// LOC owns the authored page shell. Features may update its existing
// Hero and content containers; they must not replace either ancestor.
import {useLayoutEffect} from 'react';
import {createPortal} from 'react-dom';

export function useFixedPageCanvas({
  headerClassName='',mainClassName='',headerSource='',
  imageUrl='',publicFeature='',contentClass=''
}={}){
  const canvas=typeof document==='undefined'?null:
    document.getElementById('loc-feature-hero-canvas');
  useLayoutEffect(()=>{
    if(!canvas)return undefined;
    const main=document.getElementById('loc-feature-main');
    const content=document.getElementById('loc-interactive-root');
    const title=document.getElementById('loc-static-feature-title');
    if(!main||!content)return undefined;
    const original={
      headerClass:canvas.className,mainClass:main.className,
      contentClass:content.className,source:canvas.dataset.featureHeroSource,
      feature:main.dataset.publicFeature,image:canvas.style.getPropertyValue('--scope-feature-hero-image')
    };
    if(title)title.hidden=true;
    if(headerClassName)canvas.className=headerClassName;
    if(mainClassName)main.className=mainClassName;
    if(headerSource)canvas.dataset.featureHeroSource=headerSource;
    else delete canvas.dataset.featureHeroSource;
    if(imageUrl)canvas.style.setProperty('--scope-feature-hero-image','url("'+imageUrl+'")');
    else canvas.style.removeProperty('--scope-feature-hero-image');
    if(publicFeature)main.dataset.publicFeature=publicFeature;
    else delete main.dataset.publicFeature;
    if(contentClass)content.classList.add(contentClass);
    return ()=>{
      if(title)title.hidden=false;
      canvas.className=original.headerClass;
      main.className=original.mainClass;
      content.className=original.contentClass;
      if(original.source!==undefined)canvas.dataset.featureHeroSource=original.source;
      else delete canvas.dataset.featureHeroSource;
      if(original.feature!==undefined)main.dataset.publicFeature=original.feature;
      else delete main.dataset.publicFeature;
      if(original.image)canvas.style.setProperty('--scope-feature-hero-image',original.image);
      else canvas.style.removeProperty('--scope-feature-hero-image');
    };
  },[canvas,headerClassName,mainClassName,headerSource,imageUrl,publicFeature,contentClass]);
  return canvas;
}
export function ExistingHero({canvas,children}){
  return canvas?createPortal(children,canvas):null;
}
