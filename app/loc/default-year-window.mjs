// All public views default to one complete Taiwan calendar year.
// Saved Era/Period records and explicit date navigation may override it.
export function calendarYearWindow(date=new Date()){
  const stamp=new Date(date).getTime();
  if(!Number.isFinite(stamp))throw new RangeError('Invalid calendar-year date');
  // Taiwan is UTC+8 without daylight saving. UTC getters avoid server/browser
  // timezone differences at the New Year boundary.
  const year=new Date(stamp+8*60*60*1000).getUTCFullYear();
  return {startDate:year+'-01-01',endDate:year+'-12-31',
    label:year+' 年（全年）'};
}
export const DEFAULT_YEAR_WINDOW=Object.freeze(calendarYearWindow());
