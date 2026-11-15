// Galaxy primary keys are random, not hashes of source records.
// Parent/child article references are remapped within each archive record.
export function remapArchiveArticleUids(articles,createUid,used=new Set()){
  if(!Array.isArray(articles)||typeof createUid!=='function'||!(used instanceof Set))
    throw Error('無效的匯入 UID 參數');
  const local=new Map(),sourceIds=new Set();
  for(const article of articles){
    const source=String(article?.uid||'');
    if(!source||sourceIds.has(source))
      throw Error('同一來源紀錄中存在重複或空白的文章 UID');
    sourceIds.add(source);
  }
  const remap=value=>{
    const source=String(value||'').trim();
    if(!source)return null;
    if(local.has(source))return local.get(source);
    for(let i=0;i<100;i++){
      const id=String(createUid()||'');
      if(!/^[A-Z0-9]{8}$/.test(id)||used.has(id))continue;
      used.add(id);
      local.set(source,id);
      return id;
    }
    throw Error('無法產生不重複的亂數文章 UID');
  };
  return articles.map(article=>({
    ...article,uid:remap(article.uid),
    ...(article.source_id?{source_id:remap(article.source_id)}:{}),
    ...(Array.isArray(article.target_id)?
      {target_id:article.target_id.map(value=>remap(value))}:{}),
  }));
}
