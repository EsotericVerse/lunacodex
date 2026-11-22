/**
 * Derive concise, style-bearing Meta Tags from the ENTIRE authored Suno Style.
 * Exact genre names are preserved (including composite terms); order is not a
 * three-phrase cutoff. Voice and a few explicit production/atmosphere terms are
 * eligible as separate classification dimensions. Never infer from negations.
 */
const genreTail=/(?:^|[\s/-])(?:[a-z]-?pop|mandopop|pop|a\s+cappella|acappella|rock|metal|punk|jazz|blues|folk|funk|soul|r\s*&\s*b|hip[\s-]?hop|trip[\s-]?hop|boom\s+bap|house|garage|techno|trance|breakbeat|breakcore|drum\s*(?:&|and|n)\s*bass|dnb|dubstep|dub|reggae|ska|dancehall|grime|trap|phonk|edm|idm|ambient|electronica|electronic\s+music|glitch|industrial|synthwave|retrowave|vaporwave|new\s+wave|darkwave|chillwave|chillout|downtempo|electro|disco|swing|cabaret|bossa\s+nova|lounge|lo[\s-]?fi|new\s+age|classical|orchestral|opera|operatic|requiem|ballad|lullaby|waltz|soundscape|atmosphere|turntablism|fusion|afrobeat|shibuya[\s-]?kei|character\s+song|anime\s+song)\s*$/iu;
const productionTerm=/^(?:air compression|cinematic|hopeful|calm|dark|gentle|introspective|melancholic|romantic|high energy|lo-fi|acoustic|atmospheric|vocaloid)$/iu;
const negative=/^(?:no|not|never|without|avoid|exclude|excluding|non)\b/iu;

export function sunoStyleMetaTags(source,{limit=Infinity}={}){
  const original=String(source??'').trim().replace(/^(?:Suno Style|Style)\s*:\s*/iu,'');
  if(!original)return '';
  const selected=[];
  const seen=new Set();
  const add=label=>{
    const text=String(label||'').trim();
    const key=text.normalize('NFKC').toLocaleLowerCase();
    if(text&&!seen.has(key)){seen.add(key);selected.push(text);}
  };
  for(const part of original.split(/[,，;；\r\n×]+/u)){
    const phrase=part.trim();
    if(!phrase||negative.test(phrase))continue;
    const candidate=phrase.replace(/^(?:genres?|styles?|music styles?|influences?)\s*:\s*/iu,'').trim();
    if(candidate.length<=80&&!/[\u3400-\u9FFF]/u.test(candidate)&&
       (genreTail.test(candidate)||productionTerm.test(candidate)))add(candidate);
    // Vocal is a separate Style Class; positive vocal cues remain countable,
    // but "no female vocals", "without male voice" never become tags.
    if(/\bmale\s+baritone\b/iu.test(phrase)&&!negative.test(phrase))add('Male Baritone');
    else if(/\bmale\s+(?:voice|vocals?|singer)\b/iu.test(phrase)&&!negative.test(phrase))add('Male Vocals');
    if(/\bfemale\s+(?:voice|vocals?|singer)\b/iu.test(phrase)&&!negative.test(phrase))add('Female Vocals');
    if(Number.isFinite(limit)&&selected.length>=Math.max(0,limit))break;
  }
  return selected.slice(0,Number.isFinite(limit)?Math.max(0,limit):undefined).join(', ');
}

/**
 * Re-extraction preserves explicit author assignments (LP and Rune Music).
 * Existing non-ID tags can be reviewed and changed manually in the import form.
 */
export function refreshSunoStyleMetaTags(source,current=''){
  const extracted=sunoStyleMetaTags(source);
  const explicitIds=String(current??'').split(/[,，]/u)
    .map(value=>value.trim())
    .filter(value=>/^(?:LP[0-9]+(?:-[0-9]+)?|LunaRunesMusic)$/iu.test(value));
  const tags=[...extracted.split(',').map(value=>value.trim()).filter(Boolean),...explicitIds];
  const seen=new Set();
  return tags.filter(value=>{
    const key=value.normalize('NFKC').toLowerCase();
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).join(', ');
}


/**
 * Suno Meta Tags are readable editorial notes INSIDE Galaxy.content.
 * They do not become a Galaxy.meta_tags SQL field, a second Anchor, or
 * words sung in the lyrics. Keep the lyric body unchanged and put the
 * arrangement explanation at its end, clearly marked as non-lyrics.
 */
export function appendSunoMetaTagsToArticle(content,metaTags){
  const body=String(content??'').trim();
  const tags=String(metaTags??'').trim();
  if(!tags||!body||body.includes('編曲版本說明｜非歌詞'))return body;
  const html=/<\/?(?:p|div|h[1-6]|section|ul|ol|li)\b|<br\s*\/?\s*>/iu.test(body);
  if(!html)return body+'\n\n編曲版本說明｜非歌詞\nMeta Tags：'+tags;
  const escapeHtml=text=>String(text).replace(/&/g,'&amp;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return body+'\n<p><strong>編曲版本說明｜非歌詞</strong></p>'+
    '<p>Meta Tags：'+escapeHtml(tags)+'</p>';
}
