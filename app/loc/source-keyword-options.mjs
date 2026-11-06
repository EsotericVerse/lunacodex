// Shared selector projection for Culture and Statistics. Keyword Class IDs
// and Source codes remain independent; Source choices consume published
// Scope Anchor labels, never Galaxy rows or the keyword-analysis engine.
export function sourceKeywordOptions(taxonomy){
  const choices=[];
  const seen=new Set();
  for(const [root,rows,codeKey] of [
    ['system',taxonomy?.categories||[],'category_code'],
    ['custom',taxonomy?.groups||[],'group_code']
  ]){
    for(const row of rows){
      if(row?.enabled===false)continue;
      const code=String(row?.[codeKey]||'').trim();
      const label=String(row?.display_name||code).trim();
      if(!code||!label||seen.has(code.toLocaleLowerCase()))continue;
      seen.add(code.toLocaleLowerCase());
      choices.push({key:root+':'+code,code,root,label});
    }
  }
  return choices;
}
