// LOC import source model registry. The companion virtual `type` declarations
// live in schema.zmodel and are exposed to ZenStack V3 by schema.mjs.
// These are projections over external JSON/archives, NEVER database models.
// Import and LAS/MCP may reuse the same source-to-Galaxy field paths.
// No permissions, persistence, parsing, network access, or conversions here.
const optional=type=>Object.freeze({type,optional:true});
const strings=names=>Object.fromEntries(names.split(' ').filter(Boolean)
  .map(name=>[name,optional('String')]));
const json=names=>Object.fromEntries(names.split(' ').filter(Boolean)
  .map(name=>[name,optional('Json')]));

export const SOURCE_IMPORT_MODEL_FIELDS=Object.freeze({
  WordPressPost:Object.freeze({
    ...strings('post_title post_content post_excerpt post_date post_date_gmt post_status post_type slug link'),
    ...json('id ID post_id title content excerpt date date_gmt guid parent meta categories tags')
  }),
  WordPressPostMeta:Object.freeze({
    ...strings('meta_key'),
    ...json('meta_id post_id meta_value')
  }),
  WordPressTerm:Object.freeze({
    ...strings('name slug taxonomy description'),
    ...json('term_id term_taxonomy_id parent')
  }),
  NotionPage:Object.freeze({
    ...strings('id object created_time last_edited_time url'),
    ...json('properties title parent icon cover')
  }),
  NotionBlock:Object.freeze({
    ...strings('id type created_time last_edited_time'),
    ...json('parent paragraph heading_1 heading_2 heading_3 bulleted_list_item numbered_list_item to_do quote code rich_text image file children')
  }),
  MetaFederatedPost:Object.freeze({
    ...strings('contentText caption description text message created_at'),
    ...json('timestamp_ms'),
    ...json('id post_id fbPostId igMediaId threadsPostId mediaUrls data media attachments content')
  }),
  MetaFederatedProfile:Object.freeze({
    ...strings('scopedId username fbName'),
    ...json('id userId')
  }),
  MetaInteraction:Object.freeze({
    ...strings('object_type type payload parent_id root_post_id'),
    ...json('id postId authorId parentId')
  }),
  ThreadsPublicReply:Object.freeze({
    ...strings('id root_post_id parent_id object_type'),
    ...json('timestamp author content federation_context engagement_counters')
  }),
  MsnMessage:Object.freeze({
    ...strings('session_id object_type'),
    ...json('timestamp sender recipient body')
  }),
  MessengerMessage:Object.freeze({
    ...strings('message_id thread_id object_type sender_id'),
    ...json('timestamp_ms message_body read_receipts')
  }),
  InstagramDirectMessage:Object.freeze({
    ...strings('item_id thread_id object_type sender_id message_type'),
    ...json('timestamp_ms body reactions is_vanish_mode_message')
  }),
  XDirectMessage:Object.freeze({
    ...strings('dm_id conversation_id object_type sender_id routing_tier ciphertext_body'),
    ...json('created_at_ms encryption_metadata decrypted_body_fallback_placeholder')
  })
});

const makeSource=(label,model,fields,aliases=[])=>Object.freeze({
  label,model,fields:Object.freeze(Object.fromEntries(
    Object.entries(fields).map(([field,paths])=>[field,Object.freeze(paths)]))),
  aliases:Object.freeze(aliases)
});
const models=[
  makeSource('WordPress','WordPressPost',{
    site_id:['ID','id','post_id'],
    title:['post_title','title.rendered','title.raw','title'],
    content:['post_content','content.rendered','content.raw','content'],
    createtime:['post_date_gmt','date_gmt','post_date','date','created_at'],
    url:['link','guid.rendered','guid'],
    media:['attachments','media']
  },['wordpress.org','wp']),
  makeSource('Notion','NotionPage',{
    site_id:['id','page_id','block_id'],
    title:['properties.Name.title.*.plain_text','properties.title.title.*.plain_text','title.*.plain_text','title'],
    content:['paragraph.rich_text.*.plain_text','heading_1.rich_text.*.plain_text',
      'heading_2.rich_text.*.plain_text','heading_3.rich_text.*.plain_text',
      'bulleted_list_item.rich_text.*.plain_text','numbered_list_item.rich_text.*.plain_text',
      'quote.rich_text.*.plain_text','code.rich_text.*.plain_text',
      'properties.Content.rich_text.*.plain_text','content'],
    createtime:['created_time','createdAt','last_edited_time'],
    url:['image.external.url','image.file.url','file.external.url',
      'file.file.url','url'],
    media:['image','file','media','attachments'],
    media_type:['type']
  }),
  makeSource('Facebook','MetaFederatedPost',{
    site_id:['fbPostId','post_id','id_str','id'],
    content:['contentText','data.0.post','message','text','description','body'],
    title:['title','name','subject'],
    createtime:['created_at','timestamp_ms','timestamp','creation_timestamp','date'],
    media:['mediaUrls','media','attachments']
  },['fb']),
  makeSource('Instagram','MetaFederatedPost',{
    site_id:['igMediaId','media_id','id','fbid'],
    content:['contentText','caption','text','description'],
    title:['title','name'],
    createtime:['created_at','taken_at','timestamp_ms','timestamp'],
    media:['mediaUrls','media','attachments']
  },['ig']),
  makeSource('Threads','ThreadsPublicReply',{
    site_id:['threadsPostId','id','post_id','thread_id'],
    content:['content.text','contentText','text','caption','body'],
    title:['title'],
    createtime:['timestamp','timestamp_ms','created_at','creation_timestamp'],
    media:['mediaUrls','media','attachments']
  }),
  makeSource('Messenger','MessengerMessage',{
    site_id:['message_id','id'],
    content:['message_body.text','body.text','content','text'],
    createtime:['timestamp_ms','timestamp','created_at'],
    media:['message_body.attachments','attachments','media']
  },['facebook messenger','fb messenger']),
  makeSource('Instagram DM','InstagramDirectMessage',{
    site_id:['item_id','message_id','id'],
    content:['body.text','text'],
    createtime:['timestamp_ms','timestamp','created_at'],
    media:['body.shared_content.thumbnail_url','body.attachments','attachments']
  },['instagram direct','ig dm','instagram direct message']),
  makeSource('MSN','MsnMessage',{
    site_id:['message_id','id'],
    content:['body.text','text'],
    createtime:['timestamp','created_at'],
    media:['body.custom_emoticons','attachments']
  },['msn messenger','windows live messenger']),
  makeSource('X DM','XDirectMessage',{
    site_id:['dm_id','message_id','id'],
    // No ciphertext-to-text fallback. A placeholder is not decrypted evidence.
    content:['message_data.text','text'],
    createtime:['created_at_ms','timestamp_ms','created_at'],
    media:['attachments','media']
  },['twitter dm','x direct message','twitter direct message'])
];
export const SOURCE_IMPORT_MODELS=Object.freeze(models);
export const IMPORT_SOURCE_MODEL_LABELS=Object.freeze(models.map(model=>model.label));
const byAlias=new Map();
for(const model of models)for(const alias of [model.label,...model.aliases])
  byAlias.set(alias.trim().toLowerCase(),model);
const notionBlockModel=Object.freeze({...byAlias.get('notion'),model:'NotionBlock'});
const threadsPostModel=Object.freeze({...byAlias.get('threads'),model:'MetaFederatedPost'});
const byObjectType=Object.freeze({
  msn_im_message:'MSN',
  fb_messenger_message:'Messenger',
  instagram_direct_message:'Instagram DM',
  threads_public_reply:'Threads',
  twitter_direct_message:'X DM'
});
// Only an explicit source or a recognized exact object_type selects a model.
// Notion/WordPress fields are not guessed from generic content alone.
export function sourceImportModel(source='',row=null){
  const key=String(source||'').trim().toLowerCase();
  const explicit=byAlias.get(key);
  const kind=String(row?.object_type||'').trim().toLowerCase();
  const fromKind=byAlias.get(byObjectType[kind]?.toLowerCase());
  if(fromKind)return fromKind;
  // Notion pages and blocks have distinct virtual types; both use the same
  // declarative source-to-Galaxy field paths. Ordinary Threads posts differ
  // from reply objects without inventing a cross-platform Graph ID.
  if(explicit?.label==='Notion'&&row?.object==='block')
    return notionBlockModel;
  if(explicit?.label==='Threads'&&kind!=='threads_public_reply')
    return threadsPostModel;
  return explicit||null;
}
