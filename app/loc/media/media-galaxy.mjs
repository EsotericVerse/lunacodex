// Media is Galaxy content. Only source classification belongs to SLucus.
const TYPES=new Set(['image','video','suno','rune']);

export function mediaKind(hint='',url=''){
  const type=String(hint||'').trim().toLowerCase();
  if(TYPES.has(type))return type;
  if(type==='runes')return 'rune';
  const link=String(url||'').toLowerCase();
  if(/(?:^https?:\/\/)(?:[a-z0-9-]+\.)*suno\.(?:com|ai)(?:[\/?#: ]|$)/i.test(link))return 'suno';
  if(['images','photo','photos','pic','picture','thumbnail'].includes(type)||
    /(?:^|[_/.-])(image|images|photo|photos|pic|picture|jpeg|png|jpg|gif)(?:$|[_/.-])/.test(type)||
    (!type||['url','attachment'].includes(type))&&/\.(?:png|jpe?g|gif|webp|heic|avif|svg)(?:[?#]|$)/.test(link))return 'image';
  if(['videos','reel','reels'].includes(type)||
    /(?:^|[_/.-])(video|videos|reel|reels|clip|clips)(?:$|[_/.-])/.test(type)||
    (!type||['url','attachment'].includes(type))&&/\.(?:mp4|mov|avi|webm|mkv)(?:[?#]|$)/.test(link))return 'video';
  throw new Error('不支援的媒體類型：'+(type||'unknown'));
}

export function publicMediaUrl(value){
  const text=String(value||'').trim();
  try{
    const url=new URL(text);
    return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';
  }catch{return ''}
}

export function mediaGalaxyRow(values={}){
  const rawUrl=String(values.url||'').trim();
  const url=rawUrl?publicMediaUrl(rawUrl):'';
  if(rawUrl&&!url)throw new Error('媒體作品需要有效公開網址');
  const uid=String(values.uid||'');
  if(!/^[A-Za-z0-9]{8}$/.test(uid))throw new Error('媒體作品 UID 必須為八碼');
  const title=String(values.title||'').trim()||String(values.site||'').trim()||'媒體作品';
  const description=String(values.description||values.content||'').trim();
  if(!url&&!description)throw new Error('媒體作品需要網址或內容');
  const content=description;
  const site=String(values.site||'').trim();
  if(!site)throw new Error('媒體作品需要來源 site');
  if(site.toLowerCase()==='mcp')throw new Error('site=mcp 不可作為作品來源');
  return {uid,title,content,url:url||null,site,
    ...(values.source_id?{source_id:values.source_id}:{}),
    ...(values.createtime?{createtime:values.createtime}:{}),
    statics:false,culture:true,search:true,trace:false,list:true,
    keyword:false,others:true,extract:true};
}
