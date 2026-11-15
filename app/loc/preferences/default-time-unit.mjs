// A display preference, not a database, URL, permission or date mutation.
export const DEFAULT_TIME_UNIT_KEY='loc-default-time-unit-v1';
export const DEFAULT_TIME_UNIT_CHANGED='loc-default-time-unit-changed';
export const DEFAULT_TIME_UNITS=Object.freeze(['auto','day','week','month','year']);
export function normalizeDefaultTimeUnit(value){
  return DEFAULT_TIME_UNITS.includes(value)?value:'auto';
}
export function readDefaultTimeUnit(){
  if(typeof window==='undefined')return 'auto';
  try{return normalizeDefaultTimeUnit(window.localStorage.getItem(DEFAULT_TIME_UNIT_KEY));}
  catch{return 'auto';}
}
export function saveDefaultTimeUnit(value){
  if(typeof window==='undefined')return false;
  try{
    window.localStorage.setItem(DEFAULT_TIME_UNIT_KEY,normalizeDefaultTimeUnit(value));
    window.dispatchEvent(new Event(DEFAULT_TIME_UNIT_CHANGED));
    return true;
  }catch{return false;}
}
// Calendar boundaries use date-only UTC arithmetic, never locale-dependent
// Date.parse for human input. Week begins on Monday; endDate is inclusive.
const DATE_KEY=/^\d{4}-\d{2}-\d{2}$/;
export function localTodayKey(today=new Date()){
  return [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
}
export function timeUnitBucket(day,unit='day'){
  const key=String(day||'').slice(0,10);
  if(!DATE_KEY.test(key))return null;
  const date=new Date(key+'T00:00:00Z');
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==key)return null;
  const effective=normalizeDefaultTimeUnit(unit);
  if(effective==='week'){
    date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  }else if(effective==='month'){
    date.setUTCDate(1);
  }else if(effective==='year'){
    date.setUTCMonth(0,1);
  }
  const startDate=date.toISOString().slice(0,10);
  if(effective==='week')date.setUTCDate(date.getUTCDate()+7);
  else if(effective==='month')date.setUTCMonth(date.getUTCMonth()+1);
  else if(effective==='year')date.setUTCFullYear(date.getUTCFullYear()+1);
  else date.setUTCDate(date.getUTCDate()+1);
  const endExclusive=date.toISOString().slice(0,10);
  date.setUTCDate(date.getUTCDate()-1);
  return {key:effective==='month'?startDate.slice(0,7):effective==='year'?startDate.slice(0,4):startDate,
    startDate,endDate:date.toISOString().slice(0,10),endExclusive};
}
