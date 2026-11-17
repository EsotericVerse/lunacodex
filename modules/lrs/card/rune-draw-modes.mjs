export const RUNE_DRAW_MODES=Object.freeze([
  {key:'single',count:1,label:'單卡',description:'一個問題，一個語意起點。',positions:['核心']},
  {key:'daily',count:1,label:'抽每日指示',description:'一天一張，觀看當日提示。',positions:['今日']},
  {key:'2card',count:2,label:'抽兩張',description:'以「因 → 果」觀看兩者關係。',positions:['因','果'],segments:[1,1]},
  {key:'3card',count:3,label:'抽三張',description:'以「源 → 轉 → 合」形成語意路徑。',positions:['源','轉','合'],segments:[1,1,1]},
  {key:'5card',count:5,label:'抽五張',description:'以兩個因果為基礎，加上一個變數。',positions:['過去成因 1','過去成因 2','意外變化','現在狀況 1','現在狀況 2'],segments:[2,1,2]},
  {key:'ow3gs',count:11,label:'抽11張',description:'OW3gs：兩個因果模組綜合的演算法。',positions:['1','2','3','4','5','6','7','8','9','10','11']}
]);

export const RUNE_CUSTOM_DRAW_MODES=Object.freeze([
  {key:'4card',count:4,label:'4 張',description:'1 / 2 / 1',positions:['前段','變數 1','變數 2','後段'],segments:[1,2,1],displayRows:[1,2,1]},
  {key:'6card',count:6,label:'6 張',description:'2 / 2 / 2',positions:['前段 1','前段 2','變數 1','變數 2','後段 1','後段 2'],segments:[2,2,2],displayRows:[2,2,2]},
  {key:'7card',count:7,label:'7 張',description:'2 / 3 / 2',positions:['前段 1','前段 2','變數 1','變數 2','變數 3','後段 1','後段 2'],segments:[2,3,2],displayRows:[2,3,2]},
  {key:'8card',count:8,label:'8 張',description:'3 / 2 / 3',positions:['前段 1','前段 2','前段 3','變數 1','變數 2','後段 1','後段 2','後段 3'],segments:[3,2,3],displayRows:[3,2,3]},
  {key:'9card',count:9,label:'9 張',description:'3 / 3 / 3',positions:['前段 1','前段 2','前段 3','變數 1','變數 2','變數 3','後段 1','後段 2','後段 3'],segments:[3,3,3],displayRows:[3,3,3]},
  {key:'10card',count:10,label:'10 張',description:'4 / 2 / 4',positions:['前段 1','前段 2','前段 3','前段 4','變數 1','變數 2','後段 1','後段 2','後段 3','後段 4'],segments:[4,2,4],displayRows:[2,2,2,2,2]}
]);

export const RUNE_ALL_DRAW_MODES=Object.freeze([
  ...RUNE_DRAW_MODES,
  ...RUNE_CUSTOM_DRAW_MODES
]);
