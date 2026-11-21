// Image imports create Galaxy records. Archive paths are not public image URLs.
const UID=/^[A-Za-z0-9]{8}$/;
export function publicImageUrl(value=''){
  const text=String(value??'').trim();
  if(!/^https?:\/\//i.test(text))return '';
  try{const url=new URL(text);return !url.username&&!url.password?url.href:''}
  catch{return ''}
}
export function imageGalaxyCandidates(records=[],{resolveOwner=()=>'',articlesByUid=new Map()}={}){
  const seen=new Set(),out=[];
  for(const record of records){
    if(String(record?.type||record?.media_type||'').toLowerCase()!=='image')continue;
    const original=String(record.__article_uid||'').trim();
    const parentId=String(resolveOwner(original)||'').trim();
    const parent=articlesByUid.get(original)||articlesByUid.get(parentId);
    const url=publicImageUrl(record.url);
    if(!UID.test(parentId)||!parent||!url||url===publicImageUrl(parent.url))continue;
    const caption=String(record.description||record.caption||'').trim();
    const name=String(record.title||'').trim(),parentName=String(parent.title||'').trim();
    const ownName=name&&name!==parentName&&!/^(圖片|照片|相片|image|photo)$/i.test(name);
    const content=caption||(ownName?name:'');
    if(!content)continue;
    const key=JSON.stringify([parentId,url]);
    if(seen.has(key))continue;
    seen.add(key);
    out.push({source_id:parentId,url,content,
      title:ownName?name:Array.from(content).slice(0,120).join(''),
      site:String(parent.site||'').trim(),
      createtime:record.createtime||parent.createtime||null});
  }
  return out;
}
