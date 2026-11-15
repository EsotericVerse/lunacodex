// Search syntax: space = AND, `|` or `OR` = OR, "quoted phrase" = one term,
// leading `!` or `-` = exclude.
const TOKEN=/([!-])?(?:[“"]([^”"]*)[”"]|([^\s　]+))/gu;

export function parseSearchQuery(raw){
  const text=String(raw??'').trim();
  const groups=[[]];
  const excludes=[];
  let operators=false;
  for(const match of text.matchAll(TOKEN)){
    const [token,prefix,quoted,word]=match;
    const value=String(quoted??word??'').trim();
    if(quoted===undefined&&(word==='|'||word==='OR')){
      operators=true;
      if(groups[groups.length-1].length)groups.push([]);
      continue;
    }
    if(!value||(!quoted&&!prefix&&/^[!-]+$/.test(value)))continue;
    if(quoted!==undefined)operators=true;
    if(prefix){operators=true;excludes.push(value);continue;}
    if(word&&word.includes('|')&&!quoted){
      operators=true;
      const parts=word.split('|').map(part=>part.trim());
      parts.forEach((part,index)=>{
        if(index>0&&groups[groups.length-1].length)groups.push([]);
        if(part)groups[groups.length-1].push(part);
      });
      continue;
    }
    groups[groups.length-1].push(value);
  }
  const clean=groups.filter(group=>group.length);
  const terms=[...new Set(clean.flat())];
  let exact=null;
  if(!operators)exact=text||null;
  else if(clean.length===1&&clean[0].length===1&&!excludes.length&&/[“"]/.test(text))exact=clean[0][0];
  return {groups:clean,excludes:[...new Set(excludes)],terms,exact};
}
