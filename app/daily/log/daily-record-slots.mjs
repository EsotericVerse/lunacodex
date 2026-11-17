// Calendar and editor share the same database uniqueness rule:
// one main and one supplement record per date. Never alter existing rows.
export const DAILY_RUNE_KINDS=Object.freeze(['main','supplement']);
export function dailyRecordSlots(records,recordDate){
  const date=String(recordDate||'').slice(0,10);
  const slots={main:false,supplement:false};
  for(const row of records||[]){
    if(String(row?.record_date||'').slice(0,10)!==date)continue;
    if(Object.hasOwn(slots,row.draw_kind))slots[row.draw_kind]=true;
  }
  return slots;
}
export function availableDailyRuneKind(records,recordDate,preferred='main'){
  const slots=dailyRecordSlots(records,recordDate);
  const first=DAILY_RUNE_KINDS.includes(preferred)?preferred:'main';
  if(!slots[first])return first;
  return DAILY_RUNE_KINDS.find(kind=>!slots[kind])||first;
}
