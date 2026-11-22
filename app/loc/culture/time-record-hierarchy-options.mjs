// Read-only TimeAnchor tree projection for the existing authorized editor rows.
// Era.attr.period -> Period.attr.uid -> Date. Edges are saved Anchor UIDs,
// not inferred from their dates, titles, or position in a sorted result.
// No placeholder UIDs, SQL relations, or extra queries are introduced.
const id=row=>String(row?.uid||'').trim();
const links=(row,key)=>{
  const source=Array.isArray(row?.anchor_ids)?row.anchor_ids:row?.attr?.[key];
  return Array.isArray(source)?[...new Set(source.map(String).filter(Boolean))]:[];
};
const kind=row=>row?.type==='date'?'anchor':row?.type;

export function timeRecordHierarchy(rows=[]){
  const all=Array.isArray(rows)?rows:[];
  const eras=all.filter(row=>kind(row)==='era'&&id(row));
  const periods=all.filter(row=>kind(row)==='period'&&id(row));
  const dates=all.filter(row=>kind(row)==='anchor'&&id(row));
  const periodByUid=new Map(periods.map(row=>[id(row),row]));
  const dateByUid=new Map(dates.map(row=>[id(row),row]));
  const assignedPeriods=new Set();
  const assignedDates=new Set();
  const periodBranch=row=>{
    const dates=links(row,'uid').map(uid=>dateByUid.get(uid)).filter(Boolean);
    dates.forEach(point=>assignedDates.add(id(point)));
    return {row,dates};
  };
  const groups=eras.map(era=>{
    const children=links(era,'period').map(uid=>periodByUid.get(uid)).filter(Boolean);
    children.forEach(period=>assignedPeriods.add(id(period)));
    return {row:era,periods:children.map(periodBranch)};
  });
  // Shared Periods/Dates may legitimately appear in multiple branches:
  // do not duplicate their persisted records or misclassify them as orphans.
  const unclassifiedPeriods=periods
    .filter(row=>!assignedPeriods.has(id(row))).map(periodBranch);
  const unclassifiedDates=dates.filter(row=>!assignedDates.has(id(row)));
  return {eras:groups,unclassifiedPeriods,unclassifiedDates};
}
