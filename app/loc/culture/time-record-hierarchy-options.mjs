// Presentation-only tree over already authorized TimeAnchor rows.
// Era.attr.period → Period.attr.uid → DateAnchor. Exact UID relations only;
// never attach a Date to an unrelated Period by overlapping calendar dates.
// Display old-to-new, based on the earliest saved date in each branch.
// Missing dates sort last; equal start dates use the saved UID as a stable tie.
const id=row=>String(row?.uid||'').trim();
const kind=row=>row?.type==='date'?'anchor':row?.type;
const links=(row,key)=>{
  const source=Array.isArray(row?.anchor_ids)?row.anchor_ids:row?.attr?.[key];
  return Array.isArray(source)?[...new Set(source.map(String).filter(Boolean))]:[];
};
const day=value=>{
  const v=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';
  const t=new Date(v+'T00:00:00Z');
  return Number.isNaN(t.getTime())||t.toISOString().slice(0,10)!==v?'':v;
};
const rowDay=row=>day(row?.address)||day(row?.attr?.date)||
  (Array.isArray(row?.attr?.date)?day(row.attr.date[0]):'');
const chronological=(a,b)=>a.start.localeCompare(b.start)||id(a.row).localeCompare(id(b.row));

export function timeRecordHierarchy(rows=[]){
  const all=Array.isArray(rows)?rows:[];
  const eras=all.filter(row=>kind(row)==='era'&&id(row));
  const periods=all.filter(row=>kind(row)==='period'&&id(row));
  const dates=all.filter(row=>kind(row)==='anchor'&&id(row));
  const periodByUid=new Map(periods.map(row=>[id(row),row]));
  const dateByUid=new Map(dates.map(row=>[id(row),row]));
  const assignedPeriods=new Set(),assignedDates=new Set();
  const periodBranch=row=>{
    const points=links(row,'uid').map(uid=>dateByUid.get(uid)).filter(Boolean);
    points.forEach(point=>assignedDates.add(id(point)));
    const dated=points.map(point=>({row:point,start:rowDay(point)||'9999-12-31'}))
      .sort(chronological);
    return {row,dates:dated.map(x=>x.row),
      start:dated.find(item=>item.start!=='9999-12-31')?.start||
        rowDay(row)||'9999-12-31'};
  };
  const groups=eras.map(era=>{
    const seen=new Set();
    const children=links(era,'period').map(uid=>periodByUid.get(uid))
      .filter(period=>period&&!seen.has(id(period))&&seen.add(id(period)));
    children.forEach(period=>assignedPeriods.add(id(period)));
    const periodBranches=children.map(periodBranch).sort(chronological);
    return {row:era,periods:periodBranches,
      start:periodBranches.find(item=>item.start!=='9999-12-31')?.start||
        rowDay(era)||'9999-12-31'};
  }).sort(chronological);
  // A missing parent leaves its child visible under the appropriate
  // unclassified group. Shared legitimate children are not orphaned.
  const unclassifiedPeriods=periods.filter(row=>!assignedPeriods.has(id(row)))
    .map(periodBranch).sort(chronological);
  const unclassifiedDates=dates.filter(row=>!assignedDates.has(id(row)))
    .map(row=>({row,start:rowDay(row)||'9999-12-31'}))
    .sort(chronological).map(x=>x.row);
  return {eras:groups,unclassifiedPeriods,unclassifiedDates};
}
