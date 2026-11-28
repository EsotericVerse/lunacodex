import {keywordScanText} from './content-filter.mjs';

// Suggestion-only text projection. Punctuation and symbols become boundaries
// so separate words cannot accidentally be concatenated.
const PUNCTUATION_AND_SYMBOLS=/[\p{P}\p{S}]+/gu;
const HAN=/^\p{Script=Han}+$/u;

const STOP_WORDS=new Set([
  // Pronouns and generic references
  '我','你','妳','您','他','她','它','牠','祂','咱',
  '我們','你們','妳們','您們','他們','她們','它們','牠們','祂們',
  '你我','你我他','我你','我他','他我','自己','大家','各位','本人','對方','別人','有人','人們',
  '我的','你的','妳的','您的','他的','她的','它的','我們的','你們的','他們的',
  '這','那','這個','那個','這些','那些','其','其中','此','彼','某','各','每',
  // Function words and discourse connectors
  '的','了','著','過','是','有','無','在','和','與','或','及','而','但','並','也','都',
  '很','更','最','太','才','就','又','還','已','已經','仍','仍然','曾','將','把','被',
  '讓','給','對','於','從','到','向','往','為','為了','以','之','所','則','跟','由','比',
  '不','沒','沒有','不是','不要','不用','無法','如','若','當','如果','因為','所以','因此',
  '但是','不過','然而','並且','而且','以及','或者','同時','另外','就是','只是',
  // Article attribution, credits and source boilerplate
  '作者','原作者','本文作者','作者簡介','編者','編輯','譯者','翻譯','撰文',
  '本文','原文','文章','內容','標題','本篇','這篇','該篇','來源','出處','出自','來自','來自於',
  '轉載','轉載自','轉貼','摘自','轉自','發布','發佈','發表','發文','提供','分享',
  '資料來源','文章來源','圖片來源','影片來源','出版社','版權','例如','等等','如下','上述',
  // Common generic filler
  '其他','目前','現在','之前','之後','相關','進行','使用','可以','可能','應該','需要',
  '必須','透過','如何','什麼','怎麼','為什麼','一個','一些','一種','很多','非常','比較',
  // English function words and attribution boilerplate
  'a','an','the','and','or','but','if','then','else','of','to','in','on','at','by','for',
  'from','with','as','is','are','was','were','be','been','being','it','its','i','me','my',
  'we','us','our','you','your','he','him','his','she','her','they','them','their',
  'author','source','via','posted','published','written','translator','editor'
]);

export function normalizeKeywordDiscoveryToken(value){
  return String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
}

export function isKeywordDiscoveryStopWord(value){
  return STOP_WORDS.has(normalizeKeywordDiscoveryToken(value));
}

export function isKeywordDiscoveryWord(value){
  const token=normalizeKeywordDiscoveryToken(value);
  const length=Array.from(token).length;
  return length>=2&&length<=4&&HAN.test(token)&&!STOP_WORDS.has(token);
}

export function keywordDiscoveryText(row={}){
  return keywordScanText(row)
    .replace(PUNCTUATION_AND_SYMBOLS,' ')
    .replace(/\s+/gu,' ')
    .trim();
}
