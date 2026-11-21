// Public LOC Scope homepages are emitted as authored HTML, without automatic Preact startup.
// The original interactive page remains available on demand; IPA still starts its native runtime.
import fs from 'node:fs';
import path from 'node:path';
import {HomeBlock} from '../app/loc/blocks/home-block-model.js';
import {BlockNoteContent} from '../app/loc/editor/blocknote-content.mjs';
import {parseBlockImage} from '../app/loc/blocks/hero-image.mjs';

const roots={loc:'/',lo3rwang:'/lo3rwang/',lrunes:'/lrunes/'};
const presets={
 loc:{2:{src:'/pics/LunaRunes-hero.jpg',position:'right',width:420},3:{src:'/pics/LOC-culture.jpg',position:'left',width:540},5:{src:'/pics/aboutme.webp',position:'right',width:360}},
 lo3rwang:{5:{src:'/pics/lo3rwang-3.webp',position:'right',width:420}},
 lrunes:{}
};
const labels=[['','首頁'],['culture','文化'],['statics','統計'],['trace','痕跡'],['search','搜尋'],['settings','設定']];
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function rows(scope){
 const file=path.join(process.cwd(),'app/modular/published-blocks',scope,'index.js');
 const text=fs.readFileSync(file,'utf8');
 const found=text.match(/export default (\[[\s\S]*\]);?\s*$/);
 if(!found)throw Error('Missing LOC published Scope homepage '+scope);
 const result=HomeBlock.rows(JSON.parse(found[1]),'index',8);
 if(!result.length||Number(result[0].block_order)!==1)throw Error('Published LOC hero missing '+scope);
 return result;
}
function image(row,scope){
 const order=Number(row.block_order),fallback=presets[scope]?.[order];
 const config=parseBlockImage(row.block_image);
 const entities=HomeBlock.normalizeEntities(row.block_entity);
 const embedded=BlockNoteContent.image.firstFrameImageUrl({
   subtitle:row.block_subtitle,text:row.block_text,entities
 });
 const source=['default','custom','none'].includes(config?.source)
   ?config.source:(embedded?'custom':fallback?'default':'none');
 const src=source==='none'?'':source==='default'?fallback?.src||'':
   BlockNoteContent.image.normalizeImageSource(config?.url||embedded);
 const position=order===1?'right':['left','right','top','bottom','only'].includes(config?.position)
   ?config.position:fallback?.position||'right';
 const n=Number(config?.width);
 const width=Number.isFinite(n)&&n>=160&&n<=800?n:fallback?.width||420;
 return {src,position,width};
}
function picture(media,hero){
 if(!media.src)return '';
 const webp=/^(?:https:\/\/loc\.lo3rwang\.cc)?\/pics\/LOC-2\.png(?:\?.*)?$/i.test(media.src);
 const markup='<picture>'+(webp?'<source type="image/webp" srcset="/pics/LOC-2.webp">':'')+
   '<img src="'+esc(media.src)+'" alt="框架圖片" loading="'+(hero?'eager':'lazy')+'" decoding="async"></picture>';
 return hero?'<figure class="loc-home-block__media home-hero-visual">'+markup+'</figure>':
   '<article class="loc-home-block__media loc-home-block__media-bubble loc-bubble" style="--loc-home-media-max:'+media.width+'px">'+markup+'</article>';
}
function frame(row,scope){
 const order=Number(row.block_order),hero=order===1;
 const media=image(row,scope),hasImage=Boolean(media.src);
 const only=!hero&&hasImage&&media.position==='only';
 const classes=[hero?'loc-hero loc-home-hero':'loc-card','loc-home-block',
   hero?'loc-home-block--hero':'',
   scope==='loc'&&order===3?'loc-home-block--architecture':'',
   !hero&&hasImage?(only?'loc-home-block--image-only':'loc-home-block--with-image loc-home-block--image-'+media.position):'',
   'scope-editable-block'].filter(Boolean).join(' ');
 const title=esc(row.block_title||'');
 const heading=title?'<'+(hero?'h1':'h2')+'>'+title+'</'+(hero?'h1':'h2')+'>':'';
 const header='<header class="loc-home-block__header">'+
   (row.block_eyebrow?'<p class="loc-eyebrow">'+esc(row.block_eyebrow)+'</p>':'')+heading+
   (row.block_subtitle?'<p class="loc-subtitle loc-home-block__subtitle">'+esc(HomeBlock.plainBlockLine(row.block_subtitle))+'</p>':'')+'</header>';
 const text=HomeBlock.removeDuplicatedLegacySubtitle(row.block_text,row.block_subtitle);
 const body=HomeBlock.stripLocHomeEditorPlaceholders(BlockNoteContent.image.stripHeroImageTag(text));
 const children=HomeBlock.visibleEntities({entities:HomeBlock.normalizeEntities(row.block_entity)})
   .filter(item=>item.title||String(item.text||'').replace(/<[^>]*>/g,'').trim());
 const bubbles=children.length?'<div class="loc-home-block__children" style="--loc-bubble-columns:'+
   HomeBlock.bubbleColumns(row.block_entity,'index')+'">'+children.map(item=>{
     const card=HomeBlock.childPresentation(item.title)==='card';
     return '<article class="loc-home-block__child '+(card?'loc-home-block__child--card':'loc-home-block__child--bubble')+'">'+
       (card&&item.title?'<h3>'+esc(item.title)+'</h3>':'')+
       '<div class="loc-home-block__child-copy">'+
       HomeBlock.stripLocHomeEditorPlaceholders(BlockNoteContent.image.stripHeroImageTag(item.text))+
       '</div></article>';
   }).join('')+'</div>':'';
 const sign=hero?HomeBlock.heroExtraFor(scope):null;
 const badge=sign?'<span class="home-hero-identity home-hero-identity--'+esc(sign.key)+'" role="img" aria-label="'+esc(sign.label)+'">'+esc(sign.text)+'</span>':'';
 return '<section class="'+classes+'" data-page-name="index" data-block-order="'+order+'"'+
   (hasImage&&!hero?' style="--loc-home-media-max:'+media.width+'px"':'')+'>'+header+
   (only?'<div class="loc-home-block__body loc-home-block__body--image">'+picture(media,false)+'</div>':
     body.trim()?'<div class="loc-home-block__body">'+body+'</div>':'')+
   bubbles+(only?'':picture(media,hero))+badge+'</section>';
}
function scopeHref(scope,key){
 if(key==='settings')return '/settings/?scopeid='+scope;
 return roots[scope]+(key?key+'/':'');
}
function html(scope,blocks){
 const nav='<header class="scope-global" data-native="web"><nav class="scope-nav" aria-label="Scope 導覽">'+
   '<div class="loc-static-scope-links"><a href="/lrunes/">月之符文</a><a href="/lo3rwang/">作者介紹</a></div>'+
   '<a class="scope-nav-loc-home" href="/">回月典首頁</a></nav></header>';
 const buttons='<nav class="scope-feature-dock scope-floating-edit-buttons" aria-label="Scope 功能選單">'+
   labels.map(([route,label])=>'<a href="'+esc(scopeHref(scope,route))+'"'+(!route?' aria-current="page"':'')+'><span>'+esc(label)+'</span></a>').join('')+'</nav>';
 const footer='<footer class="scope-footer" data-scope="'+scope+'"><div class="scope-footer-row">'+
   '<a href="mailto:sopa2306@gmail.com">聯絡方式</a>'+
   '<button type="button" class="loc-button" data-loc-upgrade="interface">語系與主題設定</button>'+
   '<small class="scope-footer-date-basis">日期基準：Asia/Taipei (UTC+08:00)</small></div></footer>';
 return nav+'<main class="loc-next-main" data-loc-scope="'+scope+'" data-loc-view="home">'+
   '<section class="loc-view loc-home">'+blocks.map(row=>frame(row,scope)).join('')+'</section></main>'+
   buttons+'<div class="scope-home-edit-entry"><button class="loc-button" type="button" data-loc-upgrade="edit">進入編輯模式</button></div>'+footer;
}
function inlineLoader(entry){
 // A normal DOM event loads the Preact bundle; the public reading path makes NO Preact fetch.
 const script=[
  '(()=>{let pending=false;const root=document.getElementById("loc-root");',
  'document.addEventListener("click",async event=>{',
  'const button=event.target.closest("[data-loc-upgrade]");if(!button||pending)return;',
  'event.preventDefault();pending=true;const old=root.innerHTML;',
  'const edit=button.dataset.locUpgrade==="edit";button.disabled=true;',
  'button.textContent="正在載入操作介面…";',
  'const watcher=new MutationObserver(()=>{',
  'if(!edit)return;const target=root.querySelector(".scope-home-edit-entry button:not([disabled])");',
  'if(target){watcher.disconnect();target.click();}});',
  'try{root.replaceChildren();if(edit)watcher.observe(root,{childList:true,subtree:true});',
  'await import('+JSON.stringify('/'+entry+'.js')+');',
  'setTimeout(()=>watcher.disconnect(),12000);',
  '}catch(error){watcher.disconnect();root.innerHTML=old;pending=false;',
  'console.error("LOC interactive loader failed",error);}',
  '});})();'
 ];
 return '<script id="loc-static-upgrade">'+script.join('')+'</script>';
}
export function renderPublicScopeHome({route,entry}){
 const scope=Object.keys(roots).find(key=>roots[key]===route);
 if(!scope)return null;
 const blocks=rows(scope);
 return {scope,blocks:blocks.length,html:html(scope,blocks),loader:inlineLoader(entry)};
}
