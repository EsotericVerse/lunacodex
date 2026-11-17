/**
 * Rune-life simulation, independent of the existing competitive tabletop.
 * One turn is one calendar month. Draw eight distinct runes from the 66-card
 * playable pool (Rune Zero is a codex identity, not a playable draw); select
 * five actions, leaving exactly three unused.
 *
 * The eight named aspects come from the owner. Resource effects, environment,
 * trends and narrative are supplied by the host, never invented in this core.
 * No SQL, SSO, LOC UI, Worker, or native packaging dependency.
 */
export const LIFE_ASPECTS=Object.freeze([
  Object.freeze({key:'soul',name:'靈魂',focus:'出國'}),
  Object.freeze({key:'connection',name:'連結',focus:'朋友'}),
  Object.freeze({key:'life',name:'生命',focus:'愛情'}),
  Object.freeze({key:'nature',name:'自然',focus:'寵物'}),
  Object.freeze({key:'mineral',name:'礦物',focus:'經濟'}),
  Object.freeze({key:'element',name:'元素',focus:'專精'}),
  Object.freeze({key:'order',name:'秩序',focus:'學習'}),
  Object.freeze({key:'disorder',name:'無序',focus:'娛樂'})
]);
export const LIFE_TURN=Object.freeze({
  duration:'month',draw:8,play:5,unplayed:3,trendLimit:11
});
const ALLOWED_ASPECTS=new Set(LIFE_ASPECTS.map(item=>item.key));
const PLAYABLE_RUNES=Object.freeze(Array.from({length:66},(_,i)=>i+1));
function ensureMonth(value){
  if(typeof value!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))
    throw new TypeError('Rune-life month must be YYYY-MM');
  return value;
}
export function nextLifeMonth(value){
  const [year,month]=ensureMonth(value).split('-').map(Number);
  return (month===12?year+1:year)+'-'+String(month===12?1:month+1).padStart(2,'0');
}
function allowedContext({environment={},trendRunes=[]}={}){
  if(!environment||typeof environment!=='object'||Array.isArray(environment))
    throw new TypeError('Rune-life environment must be an object');
  if(!Array.isArray(trendRunes)||trendRunes.length>11||
    trendRunes.some(id=>!Number.isInteger(id)||id<1||id>66))
    throw new TypeError('Rune-life trends must have up to 11 valid runes');
  return {environment:{...environment},trendRunes:[...trendRunes]};
}
function sampleEight(random){
  const deck=[...PLAYABLE_RUNES];
  // Partial Fisher–Yates: uniform, distinct eight-card sample.
  for(let i=0;i<LIFE_TURN.draw;i++){
    const n=random();
    if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>=1)
      throw new TypeError('random() must return a number in [0,1)');
    const j=i+Math.floor(n*(deck.length-i));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck.slice(0,LIFE_TURN.draw);
}
export function createRuneLifeEngine({random=Math.random,applyAction,resolveEvent}={}){
  if(typeof random!=='function')throw new TypeError('Rune-life requires random function');
  if(applyAction!==undefined&&typeof applyAction!=='function')
    throw new TypeError('applyAction must be a function');
  if(resolveEvent!==undefined&&typeof resolveEvent!=='function')
    throw new TypeError('resolveEvent must be a function');
  function start(month,options={}){
    ensureMonth(month);
    const context=allowedContext(options);
    return {
      kind:'lrs:boardgame/life',month,status:'selecting',
      hand:sampleEight(random),actions:[],history:[],
      environment:context.environment,trendRunes:context.trendRunes
    };
  }
  function select(state,runeId,aspect){
    if(state?.kind!=='lrs:boardgame/life'||state.status!=='selecting')
      throw new Error('Rune-life turn is not accepting actions');
    if(!state.hand.includes(runeId))throw new Error('Rune is not in the current hand');
    if(!ALLOWED_ASPECTS.has(aspect))throw new Error('Unknown Rune-life aspect');
    const prev=state.actions.filter(item=>item.runeId!==runeId);
    if(prev.length>=LIFE_TURN.play)throw new Error('Only five Rune-life actions per month');
    return {...state,actions:[...prev,{runeId,aspect}]};
  }
  async function finish(state,hostState){
    if(state?.kind!=='lrs:boardgame/life'||state.status!=='selecting')
      throw new Error('Rune-life turn is not selecting');
    if(state.actions.length!==LIFE_TURN.play)
      throw new Error('Exactly five Rune-life actions must be selected');
    const selected=new Set(state.actions.map(item=>item.runeId));
    const unused=state.hand.filter(id=>!selected.has(id));
    if(unused.length!==LIFE_TURN.unplayed)throw new Error('Three Rune-life cards must remain unplayed');
    // A host can decide resource changes/stories. Without supplied rules,
    // finish only records the choices: do not fabricate economics or events.
    let nextHost=hostState;
    for(const action of state.actions){
      if(applyAction)nextHost=await applyAction(nextHost,action,{
        month:state.month,environment:state.environment,trendRunes:state.trendRunes
      });
    }
    const event=resolveEvent?await resolveEvent({
      month:state.month,actions:state.actions,unplayed:unused,
      environment:state.environment,trendRunes:state.trendRunes,hostState:nextHost
    }):null;
    return {
      ...state,status:'complete',unplayed:unused,
      history:[...state.history,{month:state.month,actions:state.actions.map(a=>({...a})),unplayed:unused,event}],
      event,hostState:nextHost
    };
  }
  function following(completed,options={}){
    if(completed?.kind!=='lrs:boardgame/life'||completed.status!=='complete')
      throw new Error('Finish the current Rune-life month first');
    return {...start(nextLifeMonth(completed.month),options),
      history:[...completed.history]};
  }
  return Object.freeze({start,select,finish,following});
}
