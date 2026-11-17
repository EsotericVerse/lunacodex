// LOC manages the lrunes Scope. LRS serves only its independent card/game UI.
// Resolve old published Rune feature anchors at display time; do not edit SQL.
const RUNE_SCOPE='https://lrunes.lo3rwang.cc';
const LOC='https://loc.lo3rwang.cc';
const LRS='https://lrs.lo3rwang.cc';
export function runeFeatureDestination(href){
 const original=String(href??'');
 let url;
 try{url=new URL(original,RUNE_SCOPE);}catch{return original;}
 if(url.origin!==RUNE_SCOPE&&url.origin!==LOC)return original;
 let path=url.pathname;
 if(url.origin===LOC){
   if(!path.startsWith('/lrunes/'))return original;
   path=path.slice('/lrunes'.length);
 }
 const clean=path.replace(/\/+$/,'')||'/';
 let target='';
 if(clean==='/game'||clean==='/game/room')target='/game/';
 else if(clean==='/card'||clean==='/card/duel')target='/card/';
 else if(clean==='/card/daily'||clean==='/duel/daily')target='/card/daily/';
 else if(clean==='/card/list')target='/card/list/';
 else if(/^\/duel\/(?:one|two|three|four|five|six|seven|eight|nine|ten|ow3gs)$/.test(clean))target='/card/';
 return target?LRS+target+url.search+url.hash:original;
}
export function rewriteRuneFeatureAnchors(html=''){
 return String(html).replace(/<a\b[^>]*>/gi,tag=>
   tag.replace(/\bhref\s*=\s*(["'])(.*?)\1/i,(whole,quote,raw)=>{
     const before=raw.replace(/&amp;/gi,'&');
     const after=runeFeatureDestination(before);
     return after===before?whole:'href='+quote+after.replace(/&/g,'&amp;')+quote;
   })
 );
}
