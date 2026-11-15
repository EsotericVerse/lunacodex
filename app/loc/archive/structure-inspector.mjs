// Vendor-neutral, read-only structure discovery for archive contents.
// No platform switch, no database/network writes, no conversion of user content.
const FIELD_GROUPS=Object.freeze({
  id:['id','uuid','message_id','conversation_id','post_id','uid','id_str'],
  text:['text','content','body','parts','full_text','message','description','caption','prompt','response','answer','title'],
  author:['author','role','sender','sender_name','from','from_id','user','username','actor'],
  time:['timestamp','timestamp_ms','create_time','created_at','created_time','creation_timestamp','date','datetime','time','update_time','updated_at'],
  relation:['mapping','parent','children','parent_id','reply_to','in_reply_to_status_id','thread_id','conversation_id','current_node','replies','target_id'],
  attachment:['attachments','media','photos','videos','images','files','audio','asset_pointer','file_id','download_link'],
  collection:['messages','chat_messages','conversations','posts','tweets','items','records','entries','data','chats','threads','history','events'],
  project:['project','projects','project_id','project_uuid','project_name','project_title','project_instructions','custom_instructions','system_prompt','knowledge_base'],
  workspace:['workspace','workspaces','workspace_id','workspace_name','folder_id','folder_name','space_id','organization_id']
});
const normKey=k=>String(k).replace(/([a-z\d])([A-Z])/g,'$1_$2').replace(/[-\s]+/g,'_').toLowerCase();
const known=new Map(Object.entries(FIELD_GROUPS).flatMap(([kind,names])=>names.map(name=>[name,kind])));
const recognizedFormat=path=>{
  const p=String(path||'').toLowerCase();
  if(/\.(?:json|jsonl)$/i.test(p))return 'json';
  if(/\.js$/i.test(p))return 'js';
  if(/\.csv$/i.test(p))return 'csv';
  if(/\.tsv$/i.test(p))return 'tsv';
  if(/\.(?:txt|md|log)$/i.test(p))return 'text';
  if(/\.html?$/i.test(p))return 'html';
  if(/\.xml$/i.test(p))return 'xml';
  return 'other';
};
const fieldNames=sample=>{
  const seen=new Set(),keys=[];
  const re=/"((?:[^"\\]|\\.){1,96})"\s*:/g;
  let match;
  while((match=re.exec(sample))!==null&&keys.length<250){
    if(match[1].includes('\\'))continue;
    const key=normKey(match[1]);
    if(!seen.has(key)){seen.add(key);keys.push(key);}
  }
  return keys;
};
export function inspectArchiveEntryStructure(path,header=''){
  const format=recognizedFormat(path);
  const sample=String(header||'').slice(0,65536).replace(/^\uFEFF/,'').trimStart();
  const root=/^\[/.test(sample)?'array':/^\{/.test(sample)?'object':
    /^window\.YTD\./.test(sample)?'js-assignment':format==='csv'||format==='tsv'?'table':
    format==='text'?'text':format==='html'?'html':format==='xml'?'xml':'unknown';
  let keys=fieldNames(sample);
  if(format==='csv'||format==='tsv'){
    const headerLine=sample.split(/\r?\n/,1)[0]||'';
    keys=headerLine.split(format==='tsv'?'\t':',').slice(0,100).map(x=>normKey(x.replace(/^["']|["']$/g,'')));
  }
  const fields={};
  for(const kind of Object.keys(FIELD_GROUPS))fields[kind]=[];
  for(const key of keys){
    const kind=known.get(key);
    if(kind)fields[kind].push(key);
  }
  const has=key=>keys.includes(key);
  const includes=part=>keys.some(k=>k.includes(part));
  const layouts=[];
  if(has('mapping')&&(has('parent')||has('children')||has('current_node')||has('message')))layouts.push('conversation-tree');
  if(has('chat_messages')||has('messages')||has('conversation')||has('conversations')||has('chats'))layouts.push('message-list');
  if(includes('post')||includes('tweet')||has('status_updates'))layouts.push('post-list');
  if(includes('activity')||has('events')||has('history'))layouts.push('activity');
  if(fields.project.length||/\/(?:projects?|project_knowledge|project_files)\//i.test('/'+path)||/\/(?:projects|project)\.(?:json|jsonl|csv)$/i.test('/'+path))layouts.push('project-linked');
  if(fields.workspace.length)layouts.push('workspace-linked');
  if(fields.attachment.length&&(!layouts.length||has('media')||has('photos')||has('videos')))layouts.push('media');
  if(format==='csv'||format==='tsv')layouts.push('table');
  if(!layouts.length&&format==='json'&&
     (root==='array'||fields.text.length&&(fields.id.length||fields.author.length||fields.time.length)||
      fields.collection.length))layouts.push('structured-records');
  if(!layouts.length&&['text','html','xml'].includes(format))layouts.push('document');
  return {
    format,root,layouts:[...new Set(layouts)],fields,
    sampledKeys:keys.slice(0,24),keyCount:keys.length,
    hasRecognizedFields:Object.values(fields).some(v=>v.length>0)
  };
}
export function summarizeArchiveStructures(profiles=[]){
  const formats={},layouts={},fields={};
  for(const name of Object.keys(FIELD_GROUPS))fields[name]=0;
  let structuredFiles=0;
  for(const profile of profiles){
    formats[profile.format]=(formats[profile.format]||0)+1;
    for(const layout of profile.layouts)layouts[layout]=(layouts[layout]||0)+1;
    for(const [name,items] of Object.entries(profile.fields||{}))if(items.length)fields[name]=(fields[name]||0)+1;
    if(profile.layouts.length||profile.hasRecognizedFields)structuredFiles++;
  }
  return {sampledFiles:profiles.length,structuredFiles,formats,layouts,fields};
}
