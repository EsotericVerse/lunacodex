import {buildReferencedMoonRiver} from './moon-river.mjs';
/**
 * Read-only lrs:daily runtime. LOC loc:dialect owns the SQL queries, identity,
 * datasource and authorization. loc:time owns lunar-phase computation.
 */
export function createDailyModule({readDailyMonth,readDailyRange,phaseAtDate}={}){
  if(typeof readDailyMonth!=='function'||typeof readDailyRange!=='function')
    throw new TypeError('lrs:daily requires loc:dialect readDailyMonth and readDailyRange');
  if(typeof phaseAtDate!=='function')
    throw new TypeError('lrs:daily requires loc:time phaseAtDate');
  return Object.freeze({
    readMonth:query=>readDailyMonth(query),
    readRange:query=>readDailyRange(query),
    moonRiver:(start,end,lanes,visibleCount)=>buildReferencedMoonRiver(start,end,lanes,phaseAtDate,visibleCount)
  });
}
