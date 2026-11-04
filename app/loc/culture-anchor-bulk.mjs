// Pure editor helpers: no virtual anniversaries enter the stored Time graph.
const iso=value=>String(value||'').slice(0,10);
const parse=value=>{
 const text=iso(value),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
 if(!m)return null;
 const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 const d=new Date(Date.UTC(2000,month-1,day));
 if(d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
 const actual=new Date(0);actual.setUTCFullYear(year,month-1,day);
 return actual.getUTCFullYear()===year&&actual.getUTCMonth()===month-1&&actual.getUTCDate()===day
   ?{iso:text,year,month,day}:null;
};
export function planAnniversaryDates({originDate,title,startYear,endYear,firstAnniversary,lastAnniversary}){
 const origin=parse(originDate),name=String(title||'').trim();
 if(!origin||!name)throw Error('請輸入有效的紀念日名稱與原始日期');
 const from=Number(startYear),to=Number(endYear),min=Number(firstAnniversary),max=Number(lastAnniversary);
 if(![from,to,min,max].every(Number.isInteger)||from>to||min>max||min<1||to-from>200)
   throw Error('請檢查年份與週年範圍（最多 201 年）');
 const rows=[];
 for(let year=from;year<=to;year++){
   const number=year-origin.year;
   if(number<min||number>max)continue;
   const date=origin.iso.slice(0,4).replace(/^\d{4}$/,String(year).padStart(4,'0'))+origin.iso.slice(4);
   if(!parse(date))continue; // 2/29 never silently becomes 3/1.
   rows.push({date,title:name+' · '+number+' 週年',anniversary:number});
 }
 return rows;
}
export function collectTimeDates(start,end,rows=[]){
 const first=parse(start)?.iso,last=parse(end||start)?.iso;
 if(!first||!last||last<first)return [];
 return rows.filter(row=>(row.type==='anchor'||row.type==='date')&&
   parse(row.address||row.attr?.date)?.iso>=first&&
   parse(row.address||row.attr?.date)?.iso<=last)
   .sort((a,b)=>iso(a.address||a.attr?.date).localeCompare(iso(b.address||b.attr?.date)));
}
export function collectEraPeriods(periodIds,periods=[],anchors=[]){
 const byUid=new Map(anchors.map(row=>[String(row.uid),row]));
 const target=periods.filter(row=>periodIds.includes(row.uid));
 const bounds=row=>{
   const ids=Array.isArray(row.anchor_ids)?row.anchor_ids:[];
   const dates=ids.map(uid=>parse(byUid.get(uid)?.address)?.iso).filter(Boolean).sort();
   return dates.length?[dates[0],dates.at(-1)]:null;
 };
 const windows=target.map(bounds).filter(Boolean);
 const matches=periods.filter(row=>{
   const interval=bounds(row);
   return interval&&windows.some(([from,to])=>interval[0]>=from&&interval[1]<=to);
 });
 const seen=new Set();
 return matches.filter(row=>!seen.has(row.uid)&&seen.add(row.uid));
}
