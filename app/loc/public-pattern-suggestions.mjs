import {PUBLISHED_SEARCH_PATTERNS} from '../modular/published-search-patterns.js';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const ID=/^[A-Za-z0-9]{8}$/;
const norm=x=>String(x??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
// Local, bounded lookup: never probe a database, UID, or article title.
export function publicPatternSuggestions(scopeIds,raw){
  if(!Array.isArray(scopeIds)||scopeIds.length>50||typeof raw!=='string'||raw.length>120)return [];
  const input=norm(raw);if(!input||ID.test(input))return [];
  const candidates=new Set();
  for(const scope of new Set(scopeIds)){
    if(!SCOPE.test(String(scope||'')))continue;
    for(const word of PUBLISHED_SEARCH_PATTERNS[scope]||[])
      if(!ID.test(word)&&norm(word).includes(input))candidates.add(word);
  }
  return [...candidates].sort((a,b)=>Number(norm(b).startsWith(input))-
    Number(norm(a).startsWith(input))||a.localeCompare(b)).slice(0,36);
}
