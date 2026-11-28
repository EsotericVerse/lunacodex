// Lexical quality gate for NEW keyword suggestions only.
// Keep this separate from content-filter.mjs: that module cleans structural
// markup for search/import/classification and must preserve literal article text.
const STOPWORDS=new Set([
  // Pronouns and generic references
  '我','你','妳','您','他','她','它','牠','祂',
  '我們','你們','妳們','您們','他們','她們','它們','牠們','祂們',
  '你我','你我他','我你','我他','他我','自己','大家','人們',
  '我的','你的','妳的','您的','他的','她的','它的','我們的','你們的','他們的',
  // Common function words and discourse connectors
  '的','了','著','過','在','是','有','無','和','與','及','或','而','但','但是',
  '因為','所以','如果','雖然','不過','然而','因此','並且','而且','以及','同時',
  '另外','或者','就是','只是','也','都','就','才','又','還','再','已經',
  '目前','現在','之前','之後','這','那','這個','那個','這些','那些',
  '這樣','那樣','其中','相關','可以','可能','應該','需要','必須','透過',
  '進行','一個','一些','一種','很多','非常','比較','最','更','很','仍','仍然',
  '不','沒','沒有','不是','不要','不用','無法','為','為了','對','向','從','到',
  '於','被','把','跟','讓','給','由','將','比','如','若','當','以','以此',
  // Article attribution, credits and source boilerplate
  '作者','原作者','本文作者','作者簡介','編者','編輯','譯者','翻譯','撰文',
  '來源','出處','出自','來自','來自於','轉載','轉載自','轉貼','摘自','轉自',
  '發布','發佈','發表','發文','提供','分享','資料來源','文章來源',
  '圖片來源','影片來源','原文','原文出處','出版社','版權',
  // Common English function words and attribution boilerplate
  'a','an','the','and','or','but','if','then','else','of','to','in','on','at',
  'by','for','from','with','as','is','are','was','were','be','been','being',
  'it','its','i','me','my','we','us','our','you','your','he','him','his',
  'she','her','they','them','their','author','source','via','posted','published',
  'written','translator','editor'
]);

const WORD=/[\\p{L}\\p{N}]/u;

export function normalizeKeywordDiscoveryToken(value){
  return String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
}

export function isKeywordDiscoveryToken(value){
  const token=normalizeKeywordDiscoveryToken(value);
  return Boolean(token&&WORD.test(token)&&!STOPWORDS.has(token));
}

export function keywordDiscoveryStopwords(){
  return new Set(STOPWORDS);
}
