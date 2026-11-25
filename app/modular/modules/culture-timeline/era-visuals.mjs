import {visualColor} from '../../visual-palette.mjs';

const eraKey=row=>String(row?.scope_id||'')+':'+String(row?.era_uid||row?.uid||'');
function day(value){
  const s=String(value??'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))?s:'';
}
// Use the actual segmented ranges. No invented end date or filled gap.
// Assign color by chronological Era order, never by visible viewport index.
export function cultureEraVisuals(eraRows=[]){
  const real=eraRows.filter(row=>row?.entry_type==='era'&&row.uid)
    .slice().sort((a,b)=>(Number(a.group_order)||0)-(Number(b.group_order)||0)||
      String(a.start_date||'').localeCompare(String(b.start_date||''))||
      eraKey(a).localeCompare(eraKey(b)));
  const colors=new Map(),backgrounds=[],seen=new Set();
  for(const row of real){
    const key=eraKey(row);
    if(!colors.has(key))colors.set(key,visualColor(colors.size));
    const start=day(row.start_date),end=day(row.end_date);
    if(!start||!end||end<=start||String(row.class_name||'').includes('broken'))continue;
    const id='era-background:'+key+':'+start+':'+end;
    if(seen.has(id))continue;
    seen.add(id);
    backgrounds.push({id,type:'background',start,end,content:'',
      className:'scope-era-background',style:'--culture-era-color:'+colors.get(key)+';',
      selectable:false,editable:false});
  }
  return {colors,backgrounds};
}
export function paintCultureRows(rows,visuals){
  return rows.map(row=>{
    const raw=row.raw;
    if(!['era','period'].includes(raw?.entry_type))return row;
    const key=raw.entry_type==='era'?eraKey(raw):
      String(raw.scope_id||'')+':'+String(raw.era_uid||'');
    const color=visuals.colors.get(key);
    if(!color||String(raw.class_name||'').includes('broken'))return row;
    return {...row,className:[row.className,'scope-era-'+raw.entry_type].filter(Boolean).join(' '),
      style:(row.style||'')+';--culture-era-color:'+color+';'};
  }).concat(visuals.backgrounds);
}
