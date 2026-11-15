// Shared, deterministic own-Scope intersection model.
// Source, media, and total counters are independent dimensions.
// A record's source and total counts must never be summed.
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;

export const OWN_STAT_DIMENSIONS=Object.freeze([
  {kind:'source',label:'原始作品來源'},
  {kind:'media',label:'多媒體類型'},
  {kind:'total',label:'文字／多媒體總量'}
]);

const sourceLabel=value=>{
  const raw=String(value||'').trim();
  if(!raw)return '未指定來源';
  const low=raw.toLowerCase();
  if(low==='facebook'||low==='fb')return 'Facebook';
  if(low==='threads')return 'Threads';
  if(low==='ig'||low==='instagram')return 'Instagram';
  return raw;
};

export function aggregateOwnScopeStatistics(textRows=[],mediaRows=[]){
  const result=new Map();
  function add(day,kind,category){
    if(!DAY_RE.test(day))return;
    const token=kind+'\u0000'+category+'\u0000'+day;
    result.set(token,(result.get(token)||0)+1);
  }
  for(const row of Array.isArray(textRows)?textRows:[]){
    const day=String(row?.createtime||'').slice(0,10);
    if(!DAY_RE.test(day))continue;
    add(day,'source',String(row?.site||'').trim());
    add(day,'total','文字作品');
  }
  for(const row of Array.isArray(mediaRows)?mediaRows:[]){
    const day=String(row?.createtime||'').slice(0,10);
    if(!DAY_RE.test(day))continue;
    add(day,'media',String(row?.type||'').trim());
    add(day,'total','多媒體');
  }
  return [...result.entries()].map(([token,item_count])=>{
    const [kind,category,day]=token.split('\u0000');
    return {day,kind,category,item_count};
  }).sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind)||a.category.localeCompare(b.category));
}

export function ownScopeCategoryCatalog(rows=[]){
  const counters=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const kind=String(row?.kind||'').trim(),raw=String(row?.category||'').trim();
    if(!OWN_STAT_DIMENSIONS.some(item=>item.kind===kind))continue;
    const count=Number(row.item_count)||0;
    if(count<=0)continue;
    const id=kind+'\u0000'+raw;
    counters.set(id,(counters.get(id)||0)+count);
  }
  return [...counters.entries()].map(([id,total])=>{
    const [kind,raw]=id.split('\u0000');
    const name=kind==='source'?sourceLabel(raw)
      :kind==='media'?(raw||'未分類多媒體')
      :raw;
    return {id,kind,raw,name,total};
  }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
}
