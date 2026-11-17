// LunaRunes-only calendar reference lane, shared by every Culture timeline
// which explicitly references the LunaRunes daily rune source.
// Moon changes are event anchors; an event's band extends until the next
// change so a time river stays visually continuous even without draw records.
import {DAILY_MOON_PHASES} from './phases.mjs';

const DAY_MS=86400000;
const MAX_WINDOW_DAYS=3660;
const PHASE_SYMBOLS=Object.freeze(['●','◐','○','◑','◇']);

function dayMillis(value){
  const day=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return NaN;
  const ms=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===day?ms:NaN;
}
function dateAt(ms){return new Date(ms).toISOString().slice(0,10);}
function normalizedPhase(value){
  const name=String(value||'未知');
  return DAILY_MOON_PHASES.includes(name)?name:'未知';
}
export function hasReferencedDailyRune(lanes=[]){
  return Array.isArray(lanes)&&lanes.some(lane=>
    lane?.source==='daily:rune'&&String(lane?.scopeId||lane?.scope_id||'')==='lrunes'
  );
}

// Use inclusive calendar dates at the public API; Vis timeline receives
// half-open [start_date,end_date) bands. Their left edges are phase-change
// events, not density measurements, write operations, or Galaxy entries.
// This reuses the existing Taipei lunar-day phase rule, whose boundary is
// day-precision rather than an exact astronomical event timestamp.
export function buildContinuousMoonRiver(startDate,endDate,phaseAtDate){
  const from=dayMillis(startDate),to=dayMillis(endDate);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||
     (to-from)/DAY_MS>=MAX_WINDOW_DAYS||typeof phaseAtDate!=='function')return [];

  const segments=[];
  let phase='',start=from,transition=false;
  const prior=from>=DAY_MS?normalizedPhase(phaseAtDate(dateAt(from-DAY_MS))):'';
  const finish=(exclusiveEnd)=>{
    if(!phase)return;
    const index=DAILY_MOON_PHASES.indexOf(phase);
    const first=dateAt(start),last=dateAt(exclusiveEnd-DAY_MS);
    segments.push({
      id:'lrunes-real-moon:'+first,
      entry_id:'lrunes-real-moon:'+first,
      entry_type:'real_moon_phase_event',
      group_key:'lrunes-real-moon',
      group_label:'天時｜現實月相',
      group_order:-1,
      start_date:first,
      end_date:dateAt(exclusiveEnd),
      display_label:(index>=0?PHASE_SYMBOLS[index]+' ':'')+phase,
      title:(transition?'月相變動事件：':'月相延續：')+phase+'｜'+first+' ～ '+last+'（依臺灣農曆日期推算，非精確天文時刻）',
      class_name:'scope-lrunes-moon-phase scope-lrunes-moon-phase-'+(index<0?'unknown':index)+(transition?' scope-lrunes-moon-transition':''),
      moon_phase:phase,
      moon_phase_changed:transition,
      moon_phase_anchor_date:transition?first:null
    });
  };
  for(let ms=from;ms<=to;ms+=DAY_MS){
    const next=normalizedPhase(phaseAtDate(dateAt(ms)));
    if(next===phase)continue;
    finish(ms);
    transition=ms===from?next!==prior:true;
    phase=next;
    start=ms;
  }
  finish(to+DAY_MS);
  return segments;
}

// A calendar lane must never exist by itself: selecting the source is not
// enough if that selected date range contains no readable daily-rune records.
// A gap BETWEEN actual rune days is fine and does not break the moon band.
export function buildReferencedMoonRiver(startDate,endDate,lanes=[],phaseAtDate,visibleRuneCount=0){
  const count=Number(visibleRuneCount);
  return hasReferencedDailyRune(lanes)&&Number.isFinite(count)&&count>0?
    buildContinuousMoonRiver(startDate,endDate,phaseAtDate):[];
}
