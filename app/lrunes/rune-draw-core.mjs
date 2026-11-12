// Canonical draw data/reading logic, shared by the active 2D and 3D views.
import {selectRows} from '../loc/db-query.mjs';
import {RUNE_ALL_DRAW_MODES} from './rune-draw-modes.mjs';
import {buildSpreadAdvice} from './rune-guidance-engine.mjs';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';
const RUNE_DIRECTIONS=Object.freeze(['正位','半正位','半逆位','逆位']);
const RUNE_COLUMNS=lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','positive_keywords','negative_keywords','extra_rules','extra_notes');
function randomIndex(max){
  if(max<=1)return 0;
  if(globalThis.crypto?.getRandomValues){
    const limit=Math.floor(0x100000000/max)*max;
    const value=new Uint32Array(1);
    do globalThis.crypto.getRandomValues(value);while(value[0]>=limit);
    return value[0]%max;
  }
  return Math.floor(Math.random()*max);
}


function directionNo(direction){return RUNE_DIRECTIONS.indexOf(direction)+1;}

// Multi-card draws read exactly one sit_q for each drawn rune, in draw order.
async function loadVerseOnlyCards(pairs,currentMoon){
  if(!currentMoon||currentMoon==='未知')throw new Error('真實月相無法辨識，無法查詢組合籤詩。');
  const ids=pairs.map(pair=>Number(pair.runeNumber));
  const base=await selectRows('silver.runes',{
    columns:RUNE_COLUMNS,
    filters:[{column:'rune_id',operator:'in',value:ids}],
    limit:ids.length,offset:0
  });
  const cardsById=new Map((base.rows||[]).map(card=>[Number(card.rune_id),card]));
  const cards=[];
  for(const pair of pairs){
    const runeId=Number(pair.runeNumber),dir=Number(pair.dir);
    const card=cardsById.get(runeId);
    if(!card)throw new Error('抽中的符文資料不完整：'+runeId);
    const {rows}=await selectRows('silver.runes_etc',{
      columns:'desc',
      filters:[
        {column:'rune_id',operator:'eq',value:runeId},
        {column:'dir',operator:'eq',value:dir},
        {column:'type',operator:'eq',value:'sit_q'},
        {column:'current_moon',operator:'eq',value:currentMoon}
      ],
      limit:1,offset:0,source:base.dataSource||'auto'
    });
    const verse=String(rows?.[0]?.desc||'').trim();
    if(!verse)throw new Error('組合籤詩缺少 sit_q：符文 '+runeId+'、位向 '+dir+'、月相 '+currentMoon);
    cards.push({...card,rune_etc:{sit_q:{[dir]:verse}}});
  }
  return cards;
}

// One drawn rune: fetch only its exact direction and current moon (no OR list).
async function loadSingleDrawCard(pair,{staticTypes=[],moonTypes=[],currentMoon=''}) {
  const runeId=Number(pair.runeNumber),dir=Number(pair.dir);
  const base=await selectRows('silver.runes',{
    columns:RUNE_COLUMNS,
    filters:[{column:'rune_id',operator:'eq',value:runeId}],
    limit:1,offset:0
  });
  const card=base.rows?.[0];
  if(!card)throw new Error('抽中的符文資料不完整：'+runeId);
  const rune={...card,rune_etc:{}};
  const source=base.dataSource||'auto';
  const readTypes=async(types,moon)=>{
    if(!types.length)return;
    if(moon==='未知')throw new Error('真實月相無法辨識，無法查詢籤詩。');
    const filters=[
      {column:'rune_id',operator:'eq',value:runeId},
      {column:'dir',operator:'eq',value:dir},
      {column:'type',operator:'in',value:types}
    ];
    if(moon)filters.push({column:'current_moon',operator:'eq',value:moon});
    const {rows}=await selectRows('silver.runes_etc',{
      columns:'type,desc',filters,limit:types.length,offset:0,source
    });
    const found=new Map((rows||[]).map(row=>[String(row.type),String(row.desc||'').trim()]));
    for(const type of types){
      const value=found.get(type);
      // 65/66 have no daily_r/g/b canonical entries; do not invent them.
      const specialDaily=runeId>=65&&['daily_r','daily_g','daily_b'].includes(type);
      if(!value&&!specialDaily)throw new Error('籤詩資料未讀取完整：'+type+'，符文 '+runeId+'、位向 '+dir);
      if(value)rune.rune_etc[type]={[dir]:value};
    }
  };
  await readTypes(staticTypes,'');
  if(moonTypes.length){
    if(!currentMoon||currentMoon==='未知')throw new Error('真實月相無法辨識，無法查詢籤詩。');
    await readTypes(moonTypes,currentMoon);
  }
  return [rune];
}

async function loadDrawCards(pairs,{staticTypes=[],moonTypes=[],currentMoon=''}) {
  if(pairs.length===1)return loadSingleDrawCard(pairs[0],{staticTypes,moonTypes,currentMoon});
  if(!staticTypes.length&&moonTypes.length===1&&moonTypes[0]==='sit_q')
    return loadVerseOnlyCards(pairs,currentMoon);
  throw new Error('不支援的抽牌查詢組合。');
}


function runeEtcText(card,type,direction){
  return String(card?.rune_etc?.[type]?.[directionNo(direction)]||'').trim();
}


function directionText(card,direction){
  return runeEtcText(card,'direction',direction)||String(card?.rune_description||'').trim();
}
function situationQuestion(card,direction){
  return runeEtcText(card,'sit_q',direction);
}
function situationAnswer(card,direction){
  return runeEtcText(card,'sit_a',direction)||directionText(card,direction);
}
function situationDetail(card,direction){
  const question=situationQuestion(card,direction);
  const answer=situationAnswer(card,direction);
  if(question&&answer)return `狀況形容：${question}｜狀況表達：${answer}`;
  return answer||question||'資訊不足';
}



function cleanGrammarPart(value){
  return String(value||'').trim().replace(/[。；;，,\s]+$/g,'')||'資訊不足';
}

function drawSegments(mode){
  const spec=RUNE_ALL_DRAW_MODES.find(item=>item.key===mode);
  return Array.isArray(spec?.segments)?spec.segments:[];
}

function joinPoeticGroup(values=[]){
  const parts=values.map(cleanGrammarPart).filter(Boolean);
  if(parts.length<=1)return parts[0]||'資訊不足';
  return parts.join('，');
}

function trendConnector(trend){
  if(trend==='轉強')return '遂';
  if(trend==='轉弱')return '然';
  return '而';
}

function composeFixedGrammar(values,mode,trend='持平'){
  const parts=(values||[]).map(cleanGrammarPart);
  if(mode==='ow3gs'&&parts.length>=11){
    const cause=`${joinPoeticGroup(parts.slice(0,2))}；${joinPoeticGroup(parts.slice(2,4))}，遂${joinPoeticGroup(parts.slice(4,6))}`;
    const result=`${joinPoeticGroup(parts.slice(6,8))}；${parts[8]}，遂${joinPoeticGroup(parts.slice(9,11))}`;
    return `${cause}；${result}。`;
  }
  const segments=drawSegments(mode);
  if(segments.length){
    const groups=[];
    let offset=0;
    for(const size of segments){
      groups.push(joinPoeticGroup(parts.slice(offset,offset+size)));
      offset+=size;
    }
    if(groups.length===2)return `${groups[0]}，故${groups[1]}。`;
    if(groups.length===3)return `${groups[0]}；${groups[1]}，${trendConnector(trend)}${groups[2]}。`;
    return `${groups.join('；')}。`;
  }
  if(parts.length===1)return `${parts[0]}。`;
  return parts.length?`${parts.join('；')}。`:'資訊不足。';
}

function poeticClause(card,direction){
  return cleanGrammarPart(situationQuestion(card,direction));
}

function buildFixedReading(cards,directions,mode){
  const source=Array.isArray(cards)?cards:[];
  const poeticParts=source.map((card,index)=>poeticClause(card,directions[index]));
  const weighted=buildSpreadAdvice(source,directions,mode);
  const sentence=composeFixedGrammar(poeticParts,mode,weighted?.trend||'持平');
  return {sentence,domains:[],evaluation:weighted};
}


export {randomIndex,loadDrawCards,buildFixedReading};
