import {parseSearchQuery} from './search-query.mjs';

// Used only after an actual Search query. Never run during ordinary article
// browsing, Culture, Trace, or initial page load.
export function extractSearchContext(content,query,radius=10){
  const parsed=parseSearchQuery(query);
  const terms=[...new Set([parsed.exact,...parsed.terms].filter(Boolean))];
  if(!terms.length)return '';
  // Lyrics and BlockNote HTML are shown as text, never as HTML.
  const text=String(content??'')
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/\s*(?:script|style)\s*>/giu,' ')
    .replace(/<[^>]*>/gu,' ')
    .replace(/&(?:nbsp|#160);/giu,' ')
    .replace(/&(?:amp|#38);/giu,'&')
    .replace(/&(?:lt|#60);/giu,'<')
    .replace(/&(?:gt|#62);/giu,'>')
    .replace(/\s+/gu,' ').trim();
  if(!text)return '';
  const normalized=text.normalize('NFKC').toLocaleLowerCase('zh-Hant');
  let hit=-1,matched='';
  for(const term of terms){
    const needle=String(term).normalize('NFKC').toLocaleLowerCase('zh-Hant');
    if(!needle)continue;
    const index=normalized.indexOf(needle);
    if(index>=0&&(hit<0||index<hit)){hit=index;matched=needle;}
  }
  if(hit<0)return '';
  const before=Array.from(text.slice(0,hit)).length;
  const chars=Array.from(text);
  const amount=Math.max(0,Math.min(30,Math.floor(Number(radius)||10)));
  const left=Math.max(0,before-amount);
  const right=Math.min(chars.length,before+Array.from(matched).length+amount);
  return (left?'…':'')+chars.slice(left,right).join('')+(right<chars.length?'…':'');
}
