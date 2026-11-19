// Final import write boundary: PostgreSQL timestamptz(6), one timestamp
// per distinct Galaxy article. This runs AFTER source/UID reconciliation;
// it must never change the timestamp used to decide article identity.
const SECOND_US=1000000n;
const DAY=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
});
const suffix=value=>{
  const part=String(value??'').match(/T\d{2}:\d{2}:\d{2}(?:\.(\d+))?/);
  return (part?.[1]||'').padEnd(6,'0').slice(0,6);
};
export function importTimeMicroseconds(value){
  const stamp=Date.parse(String(value??''));
  if(!Number.isFinite(stamp))return null;
  // JavaScript Date resolves milliseconds; restore three extra digits
  // from an ISO source rather than rounding away PostgreSQL microseconds.
  const last=suffix(value).slice(3);
  return BigInt(stamp)*1000n+BigInt(last||'0');
}
export function formatImportMicroseconds(micros){
  const ms=micros/1000n;
  const rest=micros%1000000n;
  const second=new Date(Number(ms-(ms%1000n))).toISOString().slice(0,19);
  return second+'.'+rest.toString().padStart(6,'0')+'Z';
}
export function importCalendarDay(value){
  const stamp=Date.parse(String(value??''));
  return Number.isFinite(stamp)?DAY.format(new Date(stamp)):null;
}

// Occupied timestamps come from the indexed Galaxy date/UID scan across
// every site; newly allocated timestamps also join the set immediately.
// A collision uses free microseconds in the SAME second, preserving the day.
export function finalizeImportCreatedTimes(records,{
  occupiedTimes=[],fallbackTime=new Date().toISOString()
}={}){
  if(!Array.isArray(records))throw new TypeError('Invalid import rows');
  const occupied=new Set();
  for(const time of occupiedTimes){
    const n=importTimeMicroseconds(time);
    if(n!==null)occupied.add(n.toString());
  }
  const fallback=importTimeMicroseconds(fallbackTime);
  if(fallback===null)throw new TypeError('Invalid import fallback timestamp');
  return records.map(row=>{
    const original=importTimeMicroseconds(row?.createtime);
    const source=original===null?fallback:original;
    const second=source-(source%SECOND_US);
    const offset=source-second;
    let chosen=null;
    for(let i=0n;i<SECOND_US;i++){
      const micros=second+(offset+i)%SECOND_US;
      const key=micros.toString();
      if(occupied.has(key))continue;
      occupied.add(key);chosen=micros;break;
    }
    if(chosen===null)throw new Error('單秒內沒有剩餘微秒時間位址，無法完成唯一匯入');
    const createtime=formatImportMicroseconds(chosen);
    const {__importTimeSource:unused,...clean}=row;
    return {...clean,createtime,date:importCalendarDay(createtime)};
  });
}
