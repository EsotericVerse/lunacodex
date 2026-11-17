const DIRECTION_FACTOR=Object.freeze({
  '正位':1,
  '半正位':0.5,
  '半逆位':-0.5,
  '逆位':-1
});

const CARD_ATTR_SCORE=Object.freeze({
  1:1,
  2:0,
  3:-1,
  4:0,
  '正面':1,
  '正向':1,
  '中平':0,
  '中立':0,
  '負面':-1,
  '負向':-1,
  '未知':0
});

const DOMAIN_COPY=Object.freeze({
  '愛情':Object.freeze({
    positive:'維持互動與確認的節奏。',
    neutral:'先保留溝通與觀察空間。',
    negative:'先放慢節奏，不急著定論。'
  }),
  '事業':Object.freeze({
    positive:'可維持目前推進方式。',
    neutral:'先確認條件，再決定下一步。',
    negative:'先收斂風險，再處理下一步。'
  }),
  '關係':Object.freeze({
    positive:'維持清楚表達與互動。',
    neutral:'先確認彼此目前的位置。',
    negative:'先保留界線與調整空間。'
  }),
  '健康':Object.freeze({
    positive:'維持目前日常節奏。',
    neutral:'先留意近期身心狀態。',
    negative:'先放慢節奏並留意負荷。'
  })
});

function numericAttribute(card){
  const raw=card?.card_attr??card?.card_attribute??card?.attribute;
  const numeric=Number(raw);
  if(Number.isFinite(numeric)&&Object.hasOwn(CARD_ATTR_SCORE,numeric))return CARD_ATTR_SCORE[numeric];
  return CARD_ATTR_SCORE[String(raw||'').trim()]??0;
}

export function cardGuidanceWeight(card,direction){
  const polarity=numericAttribute(card);
  const factor=DIRECTION_FACTOR[String(direction||'').trim()]??0;
  return polarity*factor;
}

function average(values){
  if(!values.length)return 0;
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}

function spreadSides(mode,count){
  const layouts=Object.freeze({
    '2card':{x:[0],variable:[],y:[1]},
    '3card':{x:[0],variable:[1],y:[2]},
    '4card':{x:[0],variable:[1,2],y:[3]},
    '5card':{x:[0,1],variable:[2],y:[3,4]},
    '6card':{x:[0,1],variable:[2,3],y:[4,5]},
    '7card':{x:[0,1],variable:[2,3,4],y:[5,6]},
    '8card':{x:[0,1,2],variable:[3,4],y:[5,6,7]},
    '9card':{x:[0,1,2],variable:[3,4,5],y:[6,7,8]},
    '10card':{x:[0,1,2,3],variable:[4,5],y:[6,7,8,9]}
  });
  const layout=layouts[mode];
  if(!layout)return null;
  const required=Math.max(...layout.x,...layout.variable,...layout.y)+1;
  return count>=required?layout:null;
}

function trendLabel(delta){
  if(delta>=0.25)return '轉強';
  if(delta<=-0.25)return '轉弱';
  return '持平';
}

function resultBand(value){
  if(value>=0.25)return 'positive';
  if(value<=-0.25)return 'negative';
  return 'neutral';
}

function resultLabel(band){
  if(band==='positive')return '偏正';
  if(band==='negative')return '偏負';
  return '中性';
}

function trendPrefix(label){
  if(label==='轉強')return '後段較前段轉強';
  if(label==='轉弱')return '後段較前段轉弱';
  return '前後大致持平';
}

export function evaluateSpreadXY(cards=[],directions=[],mode=''){
  const source=Array.isArray(cards)?cards:[];
  const side=spreadSides(mode,source.length);
  if(!side)return null;
  const weights=source.map((card,index)=>cardGuidanceWeight(card,directions[index]));
  const x=average(side.x.map(index=>weights[index]));
  const y=average(side.y.map(index=>weights[index]));
  const delta=y-x;
  const sum=x+y;
  const overall=sum/2;
  const trend=trendLabel(delta);
  const band=resultBand(overall);
  return {
    x,
    y,
    delta,
    sum,
    overall,
    trend,
    result:resultLabel(band),
    band,
    variable:side.variable.map(index=>weights[index])
  };
}

export function buildSpreadAdvice(cards=[],directions=[],mode=''){
  const evaluation=evaluateSpreadXY(cards,directions,mode);
  if(!evaluation)return null;
  const prefix=trendPrefix(evaluation.trend);
  const domains=Object.entries(DOMAIN_COPY).map(([label,copies])=>({
    label:label+'建議',
    text:`${prefix}；${copies[evaluation.band]}`
  }));
  return {
    ...evaluation,
    summary:`前後趨勢${evaluation.trend}，整體${evaluation.result}。`,
    domains
  };
}
