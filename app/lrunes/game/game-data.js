// Restored playable LOCAL tabletop dataset using the project's historical
// 32 Alpha events (the legacy JS deletion in commit b925b520) and the
// canonical 66-symbol names. No SQL game-table dependency, no network and
// no new authoritative rule definitions.
const CATALOG=[["靈魂","靈魂彩憶界域鏡核","SL"],["連結","向斷封鍊啟分悟誤","ML"],["生命","生老病死心愛語韻","SL"],["自然","樹花葉草根種實枝","NE"],["礦物","金玉晶地石鑽礦塵","ML"],["元素","光暗水火風土雷氣","NE"],["秩序","日月星時辰明空因","OC"],["無序","福運虛夢影幻變滅","OC"]];
const HISTORIC_EVENTS=[{"id":"E01","name":"記憶","req":["SL","SL"],"desc":"過去重新浮現。"},{"id":"E02","name":"自我懷疑","req":["SL","OC"],"desc":"你開始質疑自己的定義。"},{"id":"E03","name":"真實表達","req":["SL","ML"],"desc":"必須說出真正的想法。"},{"id":"E04","name":"內在映照","req":["SL","NE"],"desc":"環境反映出你的狀態。"},{"id":"E05","name":"誤解","req":["SL","ML"],"desc":"訊息產生偏差。"},{"id":"E06","name":"合作","req":["ML","ML"],"desc":"單獨完成變得困難。"},{"id":"E07","name":"切斷","req":["ML","OC"],"desc":"某條連結必須結束。"},{"id":"E08","name":"重建關係","req":["ML","NE"],"desc":"關係進入新階段。"},{"id":"E09","name":"疾病","req":["SL","NE"],"desc":"系統需要修復。"},{"id":"E10","name":"康復","req":["SL","ML"],"desc":"開始回到正常軌道。"},{"id":"E11","name":"愛","req":["SL","OC"],"desc":"接受某種無法控制的情感。"},{"id":"E12","name":"韻律","req":["SL","NE","ML"],"desc":"找回自己的節奏。"},{"id":"E13","name":"發芽","req":["NE","NE"],"desc":"成長開始。"},{"id":"E14","name":"修剪","req":["NE","ML"],"desc":"去除不必要部分。"},{"id":"E15","name":"等待","req":["NE","OC"],"desc":"時機尚未成熟。"},{"id":"E16","name":"豐收","req":["NE","ML","OC"],"desc":"長期累積開始回收。"},{"id":"E17","name":"建立基礎","req":["ML","ML"],"desc":"穩定優先。"},{"id":"E18","name":"資源不足","req":["ML","NE"],"desc":"必須重新分配。"},{"id":"E19","name":"重建","req":["ML","OC"],"desc":"舊結構失效。"},{"id":"E20","name":"結晶","req":["ML","SL","OC"],"desc":"經驗開始固化。"},{"id":"E21","name":"火花","req":["NE","OC"],"desc":"新變化出現。"},{"id":"E22","name":"風向改變","req":["NE","ML"],"desc":"環境開始轉向。"},{"id":"E23","name":"洪流","req":["NE","NE","OC"],"desc":"變化超出預期。"},{"id":"E24","name":"平衡","req":["NE","SL","ML"],"desc":"多種力量需要協調。"},{"id":"E25","name":"選擇","req":["OC","ML"],"desc":"必須取捨。"},{"id":"E26","name":"時機","req":["OC","NE"],"desc":"不是不能做，而是何時做。"},{"id":"E27","name":"規則","req":["OC","ML","SL"],"desc":"建立新的邊界。"},{"id":"E28","name":"定錨","req":["OC","OC"],"desc":"做出不可逆決定。"},{"id":"E29","name":"偶然","req":["OC","NE"],"desc":"預期外事件發生。"},{"id":"E30","name":"幻象","req":["OC","SL"],"desc":"真假難辨。"},{"id":"E31","name":"空窗","req":["OC","ML"],"desc":"沒有明顯答案。"},{"id":"E32","name":"未知來信","req":["SL","ML","NE","OC"],"desc":"世界要求全面回應。"}];
const ASPECT={"靈魂":"SL","連結":"ML","生命":"SL","自然":"NE","礦物":"ML","元素":"NE","秩序":"OC","無序":"OC"};
export const DEFAULT_TABLETOP_CONFIG=Object.freeze({
  playerMin:2,playerMax:4,deMin:0,deMax:32,deStart:8,
  openingDraw:8,openingDiscard:3,handBase:5,handTempCap:8,
  eventResponseCards:3,eventDraw:0,failDraw:0,
  resonanceSelf:2,resonanceAttack:-2
});
export function localTabletopRules(){
  const cards=CATALOG.flatMap(([group,characters],index)=>[...characters].map((name,i)=>({
    id:index*8+i+1,name,group,alphaCompatMacro:ASPECT[group]
  })));
  cards.push({id:65,name:'玄',group:'特殊',alphaCompatMacro:null});
  cards.push({id:66,name:'命',group:'特殊',alphaCompatMacro:null});
  const events=HISTORIC_EVENTS.map(e=>({id:e.id,name:e.name,
    description:e.desc,req:[...e.req]}));
  const resultByCoverage=new Map([
    [0,{code:'fail',label:'失敗',delta:-2,drawCount:0}],
    [1,{code:'partial',label:'部分回應',delta:-1,drawCount:0}],
    [2,{code:'neutral',label:'普通',delta:0,drawCount:0}],
    [3,{code:'success',label:'成功',delta:1,drawCount:0}],
    [4,{code:'perfect',label:'完美',delta:2,drawCount:0}]
  ]);
  const rounds=Array.from({length:8},(_,i)=>({
    round:i+1,phase:i%2===0?'event':'resonance'
  }));
  return {cards,events,resultByCoverage,rounds,config:DEFAULT_TABLETOP_CONFIG};
}
export function shuffle(list){
  const result=[...(list||[])];
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
export function draw(player,count,config){
  const room=Math.max(0,config.handTempCap-player.hand.length);
  const n=Math.min(count,room,player.deck.length);
  return {...player,hand:[...player.hand,...player.deck.slice(0,n)],deck:player.deck.slice(n)};
}
export function freshPlayer(cards,name,config,shuffleFn=shuffle){
  const deck=shuffleFn(cards);
  return {name,de:config.deStart,deck:deck.slice(config.openingDraw),
    hand:deck.slice(0,config.openingDraw),discard:[],selected:[],opening:true};
}
export function finishOpening(player,ids,config){
  if(ids.length!==config.openingDiscard||new Set(ids).size!==ids.length)
    throw Error('起手棄牌數量不正確');
  const selected=new Set(ids),discarded=player.hand.filter(c=>selected.has(c.id));
  if(discarded.length!==config.openingDiscard)throw Error('起手牌無效');
  return {...player,hand:player.hand.filter(c=>!selected.has(c.id)),
    discard:[...player.discard,...discarded],selected:[],opening:false};
}
export function applyDe(player,delta,config){
  return {...player,de:Math.max(config.deMin,Math.min(config.deMax,player.de+delta))};
}
export function evaluateAlphaEvent(cards,event,resultByCoverage,config){
  if(cards.length!==config.eventResponseCards)throw Error('事件回應張數不正確');
  const pool=[...event.req];let hits=0;
  for(const card of cards){
    const index=pool.indexOf(card.alphaCompatMacro);
    if(index>=0){hits++;pool.splice(index,1);}
  }
  const diversity=new Set(cards.map(card=>card.group)).size;
  const coverage=Math.min(4,hits+Math.min(2,diversity));
  const result=resultByCoverage.get(coverage);
  if(!result)throw Error('事件評估資料不完整');
  return {...result,coverage};
}
