// Source signatures for read-only archive identification.
// A path is only a hint (confidence=1). Confidence=3 needs matching payload features.
// Unknown vendors are deliberately not guessed from generic "messages.json" names.
// Filename only suggests an adapter; archive entries still determine the record schema.
export function archiveFilenameSource(filename){
  const name=String(filename||'').toLowerCase();
  for(const [pattern,source] of [
    [/chatgpt|openai/,'chatgpt'],[/threads/,'threads'],[/facebook/,'facebook'],
    [/instagram/,'instagram'],[/claude|anthropic/,'claude'],[/twitter|tweet/,'x'],
    [/telegram/,'telegram'],[/whatsapp/,'whatsapp']
  ])if(pattern.test(name))return source;
  return null;
}
export const ARCHIVE_SOURCE_ORDER=Object.freeze([
  'chatgpt','claude','gemini','grok','copilot','perplexity','meta-ai',
  'facebook','messenger','instagram','threads','whatsapp','x',
  'telegram','discord','line','slack','teams','snapchat','wechat','tiktok','reddit','linkedin','pinterest','youtube','google-takeout'
]);

const normalized=value=>String(value||'').replace(/\\/g,'/').replace(/^\/+/,'').toLowerCase();
const segmented=(path,part)=>path.split('/').includes(part);
const named=(name,token)=>new RegExp('(?:^|[-_. ])'+token+'(?:$|[-_. ])','i').test(name);

export function archiveEntrySignatures(path,head=''){
  const p=normalized(path),base=p.split('/').at(-1)||'',sample=String(head||'').slice(0,65536);
  const found=new Map();
  const add=(source,confidence)=>found.set(source,Math.max(found.get(source)||0,confidence));
  const contains=(...fields)=>fields.every(field=>sample.includes('"'+field+'"'));
  const takeout=/^(?:[^/]+\/)*takeout\//.test(p);
  const metaFacebook=segmented(p,'facebook')||segmented(p,'your_facebook_activity')
    ||/(?:^|\/)posts\/your_posts(?:_\d+)?\.json$/.test(p)
    ||/(?:^|\/)posts\/status_updates(?:_\d+)?\.json$/.test(p);
  const metaInstagram=segmented(p,'instagram')||p.includes('your_instagram_activity/');
  const metaThreads=segmented(p,'threads')||p.includes('threads_and_replies/');
  const isMessenger=metaFacebook&&/\/messages\/(?:inbox|archived_threads|message_requests|filtered_threads)\//.test('/'+p);
  const xPath=segmented(p,'twitter')||segmented(p,'x')||/^(?:tweets|note-tweet|note-tweets)(?:[-_.]part\d+)?\.(?:js|json)$/.test(base);
  // No "conversations.json" hint here: Claude uses the same filename.
  if(segmented(p,'chatgpt')||segmented(p,'openai'))add('chatgpt',1);
  if(segmented(p,'claude')||segmented(p,'anthropic'))add('claude',1);
  if(segmented(p,'grok')||segmented(p,'xai')||named(base,'grok'))add('grok',1);
  if(segmented(p,'copilot')||named(base,'copilot'))add('copilot',1);
  if(segmented(p,'perplexity')||named(base,'perplexity'))add('perplexity',1);
  if(segmented(p,'meta-ai')||segmented(p,'meta_ai'))add('meta-ai',1);
  if(metaFacebook)add('facebook',1);
  if(metaInstagram)add('instagram',1);
  if(metaThreads)add('threads',1);
  if(isMessenger)add('messenger',1);
  if(xPath)add('x',1);
  if(segmented(p,'telegram'))add('telegram',1);
  if(segmented(p,'discord'))add('discord',1);
  if(segmented(p,'line')||/^chat history in -.+-\.txt$/.test(base))add('line',1);
  if(segmented(p,'slack'))add('slack',1);
  if(segmented(p,'teams')||segmented(p,'microsoft-teams'))add('teams',1);
  if(segmented(p,'snapchat')||/^(?:memories_history|chat_history)\.(?:json|html)$/.test(base)&&/^(?:json|html)\//.test(p))add('snapchat',1);
  if(segmented(p,'wechat')||segmented(p,'weixin'))add('wechat',1);
  if(segmented(p,'pinterest'))add('pinterest',1);
  if(segmented(p,'tiktok')||named(base,'tiktok'))add('tiktok',1);
  if(segmented(p,'reddit')||named(base,'reddit'))add('reddit',1);
  if(segmented(p,'linkedin')||named(base,'linkedin'))add('linkedin',1);
  if(takeout)add('google-takeout',1);
  if((takeout&&/\/(?:my activity\/)?(?:gemini apps|bard)\//.test(p))||
     (takeout&&/\/gemini(?:\/|$)/.test(p)))add('gemini',3);
  if(takeout&&/\/youtube(?: and youtube music)?\//.test(p))add('youtube',3);
  if((/^(?:_chat|whatsapp chat(?: with .+)?)\.txt$/.test(base)||segmented(p,'whatsapp')))
    add('whatsapp',1);

  // Provider-specific structure checks (no full payload parsing or storage).
  if(contains('mapping','create_time','title')&&/"mapping"\s*:\s*\{/.test(sample))
    add('chatgpt',3);
  if(contains('chat_messages','uuid')&&(contains('sender')||contains('created_at')))
    add('claude',3);
  if(/window\.YTD\.[\w-]+\.part\d+\s*=/.test(sample)&&
     /(?:tweet|noteTweet|directMessage)/.test(sample))add('x',3);
  if(contains('text_post_app_text_posts')||contains('threads_posts'))add('threads',3);
  if(contains('ig_posts')||contains('ig_reels_media'))add('instagram',3);
  if(contains('status_updates')&&metaFacebook)add('facebook',3);
  if(contains('messages')&&contains('participants')&&isMessenger)add('messenger',3);
  if(contains('messages')&&contains('participants')&&metaFacebook)add('facebook',3);
  if(contains('messages')&&contains('participants')&&metaInstagram)add('instagram',3);

  // Non-JSON vendors: read a short TXT/CSV sample, never infer from a generic name.
  if(/\.txt$/.test(base)&&(
      /^(?:_chat|whatsapp chat(?: with .+)?)\.txt$/.test(base)||segmented(p,'whatsapp'))&&
      /(?:^|\n)(?:\[\s*\d{1,4}[-/]\d\d?[-/]\d{2,4}[,\s]+[^\]\n]{2,40}\]\s*|\d{1,4}[-/]\d\d?[-/]\d{2,4}[,\s]+[^\n]{2,40}\s+-\s+)[^\n:：]{1,80}[:：]\s*\S/m.test(sample))
    add('whatsapp',3);
  // Telegram Desktop result.json has a chats list and Telegram-specific message fields.
  if(/(?:^|\/)result\.json$/.test(p)&&
     ((contains('chats','list')&&contains('personal_information'))||
      (contains('messages','from_id')&&contains('text_entities'))))add('telegram',3);
  if(/\/messages\/[^/]+\/messages\.json$/.test('/'+p)&&
     contains('ID','Timestamp','Contents'))add('discord',3);
  if(contains('video browsing history')&&contains('video list')&&/tiktok/.test(p))
    add('tiktok',3);
  if(/\.txt$/.test(base)&&/^chat history in -.+-\.txt$/.test(base)&&
     /(?:^|\n)\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(sample)&&
     /(?:^|\n)\d\d:\d\d[\t ]+[^\n\t ]{1,60}[\t ]+.+/m.test(sample))add('line',3);
  if(/^(?:json\/)?memories_history\.json$/.test(p)&&
     contains('Date','Media Type')&&(contains('Download Link')||contains('Media Download Url')))
    add('snapchat',3);
  if((segmented(p,'teams')||segmented(p,'microsoft-teams'))&&
     contains('createdDateTime','body')&&(contains('chatId')||contains('messageType')))
    add('teams',3);
  if(/\.csv$/.test(base)&&/^(?:comments|posts)\.csv$/.test(base)&&
     segmented(p,'reddit')&&/(?:subreddit|permalink)/i.test(sample))add('reddit',3);
  if(/\.csv$/.test(base)&&/^(?:connections|messages|profile)\.csv$/.test(base)&&
     segmented(p,'linkedin'))add('linkedin',3);
  if(/\.csv$/.test(base)&&/copilot/i.test(p)&&
     /(?:prompt|question)/i.test(sample)&&/(?:response|answer)/i.test(sample))
    add('copilot',3);

  return [...found].map(([source,confidence])=>({source,confidence,path}));
}

// "Google Takeout" is a container, not an extra content source, when a more
// specific Google product has already been recognized in that archive.
export function summarizeArchiveSources(hits){
  const picked=new Map(hits);
  if(picked.has('google-takeout')&&(picked.has('gemini')||picked.has('youtube')))
    picked.delete('google-takeout');
  const sources=ARCHIVE_SOURCE_ORDER.filter(source=>picked.has(source));
  return {
    kind:sources.length>1?'mixed':sources[0]||'unknown',
    sources,
    confidence:sources.length?Math.min(...sources.map(source=>picked.get(source).confidence)):0,
    evidence:sources.map(source=>({
      source,path:picked.get(source).path,
      verified:picked.get(source).confidence===3
    }))
  };
}
