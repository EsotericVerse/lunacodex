// On-demand, read-only discovery of new literal Keywords from Galaxy content.
// Existing Keywords are used ONLY as an exclusion set; no classifications are changed.
const IGNORE_ZH=new Set('我們 你們 他們 這個 那個 這些 那些 自己 可以 可能 沒有 不是 什麼 怎麼 為什麼 因為 所以 如果 然後 但是 不過 已經 還是 真的 覺得 知道 一個 一些 一種 一樣 這樣 那樣 現在 今天 昨天 明天 時候 事情 問題 東西 地方 目前 之後 之前 以及 其中 其他 以上 以下 只是 就是 還有 而且 需要 進行 使用 發現 看到 發生 成為 只有 不能 不會 也許 其實 開始 結果 最後 大家 例如 例如說 文章 內容 發表 動態 分享 連結 標題 時間 日期 發文 網站 網頁 作者 資料 資訊 文字 檢查 進去 出來 回來 什麼樣 都是 也是 這是 那是 這裡 那裡 但是 因此 方法 方式 主要 相關 包含 包括 應該 這麼 那麼 或者 以及 之間 時間點 今天晚上 現在目前'.split(/\s+/u));
// Eliminate boilerplate and connective fragments, not actual thematic words.
for(const word of '我的 你的 他的 她的 自己的 我想 我們的 你們的 不同 不必 正式 原始 大綱 曲名 文字稿 段落 寫作 版本 作品 歌詞 這首 這首歌 一首歌 寫一首歌 先前 這次 再次 一片 還在 站在 落在 做到 看來 留下 大部分 開頭 結尾 每次 本來 然而 同時 必須 總是 這種 那種 一直 反而 已有 不同於 另外 如同 作為 來自 多數 各種 透過 相關的 文字的 說明 資料庫 目前的 都可以 沒辦法 這樣的 這樣子 不一樣'.split(/\s+/u))IGNORE_ZH.add(word);
const IGNORE_EN=new Set('the and for that this with from have has had are was were you your they them their our his her what why how when where which just also can could would should not all one two into about there here then than more less some any out use used using via http https www com org net facebook threads instagram posted share post photo photos image images video media title text content article link links'.split(/\s+/u));
// Do not join across grammatical connectors or common filler words.
const JOIN_BREAK=new Set('的 了 與 和 及 在 對 從 讓 把 是 就 能 也 都 更 才 卻 但 而 被 向 過 其 我 你 他 她 它 此 那 這 為 會 應 可 不 沒 有 要 到 去 來 將 再 又 若 或 之 於 啊 嗎 呢 吧 耶 啦 哦 一 個 很 多 少 真 太 最 還 只 又 仍 已 且 以 因 故 所 者 也 已經 可以 因為 所以 但是 可是 以及 而且 或者 我想 這個 那個 一個 很多 許多 那些 這些 要用 同樣 寫 編寫 製作 撰寫 請用 請以 依照 按照 幫我 把它 再寫 改成 改寫 寫成 產生 生成 使用'.split(/\s+/u));
const HAN=/^\p{Script=Han}+$/u;
const LATIN=/^[\p{Script=Latin}][\p{Script=Latin}\d+#-]*$/u;
const MAX_TERMS=85000;
const SOURCE_MARKUP_TERMS=new Set('div span html head body main section article header footer nav button input textarea form label select option fieldset iframe script style svg path g circle rect line ul ol li p br hr a img picture source link meta noscript canvas table thead tbody tr th td h1 h2 h3 h4 h5 h6 class classname href src alt rel target onclick onload xmlns width height data aria const let var function return import export default async await props state useeffect usestate usememo null undefined true false json jsonb jsx tsx css js javascript typescript html5 markdown field column key value object array boolean'.split(/\s+/u));
const TEXT_FIELDS=new Set(['text','content','body','paragraph','paragraphs','message','description','lyric','lyrics','story','article']);
export function readableKeywordContent(raw){
  if(raw==null)return '';
  let source=String(raw);
  const trimmed=source.trim();
  if((trimmed.startsWith('{')&&trimmed.endsWith('}'))
    ||(trimmed.startsWith('[')&&trimmed.endsWith(']'))){
    try{
      const parsed=JSON.parse(trimmed);
      const texts=[];
      const walk=(item,allowText=false,depth=0)=>{
        if(depth>8||texts.length>=1000)return;
        if(typeof item==='string'){if(allowText)texts.push(item);return;}
        if(Array.isArray(item)){for(const val of item)walk(val,allowText,depth+1);return;}
        if(!item||typeof item!=='object')return;
        for(const [key,value] of Object.entries(item)){
          if(TEXT_FIELDS.has(key.toLowerCase()))walk(value,true,depth+1);
          else if(value&&typeof value==='object')walk(value,false,depth+1);
        }
      };
      walk(parsed);
      source=texts.join(' ');
    }catch{source='';}
  }
  return source
    .replace(/&lt;/giu,'<').replace(/&gt;/giu,'>')
    .replace(/<!--[\s\S]*?-->/gu,' ')
    .replace(/<(script|style|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,' ')
    .replace(/\x60{3}[\s\S]*?\x60{3}/gu,' ')
    .replace(/<[^>]*>/gu,' ')
    // A truncated opening/closing tag (e.g. '<div' or '<div class="x"')
    // must be removed BEFORE word segmentation, not counted as prose.
    .replace(/<\/?\s*(?:div|span|script|style|section|article|header|footer|main|nav|p|br|hr|a|img|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|button|input|textarea|form|label|select|option|svg|path|iframe|link|meta)\b[^<>\r\n]*/giu,' ')
    .replace(/\x60[^\x60]*\x60/gu,' ')
    .replace(/!?\[([^\]]+)\]\(https?:\/\/[^)]+\)/giu,'$1')
    .replace(/https?:\/\/[^\s\]<>]+/giu,' ')
    .replace(/&(?:[a-z]{2,10}|#\d+);/giu,' ');
}

const normalize=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();
function admissible(token){
  const value=normalize(token);
  if(SOURCE_MARKUP_TERMS.has(value))return false;
  if(HAN.test(value))return [...value].length>=2&&[...value].length<=8&&!IGNORE_ZH.has(value)&&!/(.)\1{2,}/u.test(value);
  if(LATIN.test(value))return value.length>=3&&value.length<=30&&!IGNORE_EN.has(value);
  return false;
}
export function existingKeywordSet(rows=[]){
  const found=new Set();
  for(const row of rows){
    // Include Item names too; a term already named as an Item isn't "new".
    if(row?.type!=='item')continue;
    const name=normalize(row.name);
    if(name)found.add(name);
    for(const term of Array.isArray(row.lists)?row.lists:[]){
      const key=normalize(term);
      if(key)found.add(key);
    }
  }
  return found;
}
export function createNewKeywordDiscovery(rows=[]){
  const existing=existingKeywordSet(rows);
  const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
  const totals=new Map();
  const months=new Map();
  // Coverage is read-only literal evidence, NOT a rewrite/reclassification
  // of existing Keyword records. Single Han characters are too ambiguous
  // for this estimated ratio, so use terms with >=2 characters.
  const known=[...existing].filter(term=>[...term].length>=2)
    .sort((a,b)=>b.length-a.length);
  const regexMeta=new Set(['\\','.','*','+','?','^','$','{','}','(',')','|','[',']']);
  const escapeRegex=term=>[...term].map(char=>regexMeta.has(char)?'\\'+char:char).join('');
  const knownMatchers=[];
  for(let offset=0;offset<known.length;offset+=100)
    knownMatchers.push(new RegExp(known.slice(offset,offset+100).map(escapeRegex).join('|'),'u'));
  let read=0,withContent=0,limited=false;
  function add(term,seen,month,body,position,length){
    const key=normalize(term);
    if(!admissible(key)||existing.has(key))return;
    let record=totals.get(key);
    if(!record){
      if(totals.size>=MAX_TERMS){limited=true;return;}
      // Excerpts are retained once per distinct candidate, not allocated
      // for each segment across tens of thousands of documents.
      const sample=body.slice(Math.max(0,position-28),
        Math.min(body.length,position+length+32)).replace(/\s+/gu,' ').trim();
      record={word:key,documents:0,occurrences:0,months:new Map(),sample};
      totals.set(key,record);
    }
    record.occurrences++;
    if(seen.has(key))return;
    seen.add(key);
    record.documents++;
    if(month)record.months.set(month,(record.months.get(month)||0)+1);
  }
  function consume(batch=[]){
    for(const row of batch){
      read++;
      const body=readableKeywordContent(row?.content);
      if(!body.trim())continue;
      withContent++;
      const seen=new Set();
      const month=String(row?.createtime||'').slice(0,7);
      if(/^\d{4}-\d{2}$/.test(month)){
        const item=months.get(month)||{month,documents:0,existingCovered:0};
        item.documents++;
        const normalized=normalize(body);
        if(knownMatchers.some(re=>re.test(normalized)))item.existingCovered++;
        months.set(month,item);
      }
      let prev=null,prev2=null;
      for(const piece of segmenter.segment(body)){
        const token=String(piece.segment||'').trim();
        const isHan=HAN.test(token);
        if(piece.isWordLike){
          add(token,seen,month,body,piece.index,token.length);
          if(prev&&prev.end===piece.index&&prev.han&&isHan
            &&!JOIN_BREAK.has(token)&&!JOIN_BREAK.has(prev.token)
            &&!IGNORE_ZH.has(token)&&!IGNORE_ZH.has(prev.token)){
            const combined=prev.token+token;
            if([...combined].length>=3&&[...combined].length<=8)
              add(combined,seen,month,body,prev.start,combined.length);
            // Chinese word segmentation sometimes splits a phrase into 1+1+2.
            if(prev2&&prev2.han&&prev2.end===prev.start
              &&!JOIN_BREAK.has(prev2.token)&&!IGNORE_ZH.has(prev2.token)){
              const triple=prev2.token+combined;
              if([...triple].length>=4&&[...triple].length<=8)
                add(triple,seen,month,body,prev2.start,triple.length);
            }
          }
          prev2=prev;
          prev={token,start:piece.index,end:piece.index+piece.segment.length,han:isHan};
        }else{
          prev=null;prev2=null;
        }
      }
    }
    return {read,withContent,limited};
  }
  function finish({limit=240,minDocuments=3}={}){
    const minimum=withContent<100?2:minDocuments;
    // A repeatedly used compound is often a better addition than a generic
    // two-character fragment. Keep document coverage as the primary signal.
    const score=term=>term.documents*(1+(HAN.test(term.word)
      ?Math.min(Math.max([...term.word].length-2,0),4)*0.18:0));
    const rank=(a,b)=>score(b)-score(a)||b.documents-a.documents||b.occurrences-a.occurrences
      ||b.word.length-a.word.length||a.word.localeCompare(b.word);
    const all=[...totals.values()].filter(term=>term.documents>=minimum);
    const chinese=all.filter(term=>HAN.test(term.word)).sort(rank);
    const other=all.filter(term=>!HAN.test(term.word)).sort(rank);
    const maximum=Math.max(1,Math.min(240,limit));
    // Keep English music-production wording from crowding out every Chinese
    // candidate. These are display lanes, NOT Keyword Classes or Groups.
    const primary=chinese.slice(0,Math.ceil(maximum*0.7));
    const secondary=other.slice(0,Math.floor(maximum*0.3));
    let result=[...primary,...secondary];
    if(result.length<maximum){
      const used=new Set(result.map(term=>term.word));
      const extra=all.filter(term=>!used.has(term.word)).sort(rank);
      result.push(...extra.slice(0,maximum-result.length));
    }
    result=result.map(term=>({...term,language:HAN.test(term.word)?'zh':'other',
      months:[...term.months.entries()].sort(([a],[b])=>a.localeCompare(b))}));
    return {read,withContent,limited,existingCount:existing.size,
      monthCoverage:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),
      candidates:result};
  }
  return {consume,finish};
}
