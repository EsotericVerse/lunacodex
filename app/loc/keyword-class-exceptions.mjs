// Class-only exception terms. No article UID cache or posting list is stored
// here: Class.attr only owns rules; Pattern.attr owns Galaxy article IDs.
const MAX_TERMS=1000,MAX_LENGTH=256;
export function classSkipArticleWords(value={}){
  const attr=typeof value==='string'?JSON.parse(value):value;
  const entries=attr?.exceptions?.skip_article??[];
  if(!Array.isArray(entries)||entries.length>MAX_TERMS)
    throw new TypeError('Invalid Class skip_article exceptions');
  const words=new Map();
  for(const item of entries){
    if(typeof item!=='string'||!item.trim()||item.length>MAX_LENGTH)
      throw new TypeError('Invalid Class exception keyword');
    const name=item.trim(),key=name.normalize('NFKC').toLocaleLowerCase('zh-Hant');
    if(!words.has(key))words.set(key,name);
  }
  return [...words.values()];
}
