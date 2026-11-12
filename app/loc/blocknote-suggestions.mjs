// Type-scoped, bounded autocomplete for existing LOC Anchor and published Pattern data.
// No database reads or writes: callers supply rows already authorized for their Scope.
import {z} from 'zod';

const KIND=z.enum(['spatial','time','pattern']);
const TYPE=z.enum(['point','path','trace','date','period','era','aniversary','pattern']);
const CANDIDATE=z.object({
  type:TYPE,
  title:z.string().trim().min(1).max(240),
  uid:z.string().regex(/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/).optional()
});
const QUERY=z.string().trim().max(120);
const TYPES=Object.freeze({
  spatial:new Set(['point','path','trace']),
  time:new Set(['date','period','era','aniversary']),
  pattern:new Set(['pattern'])
});
const normalized=value=>String(value).normalize('NFKC').toLocaleLowerCase('zh-Hant');

export function blockNoteSuggestionItems(kind,rows=[],query='',limit=24){
  const selected=KIND.safeParse(kind),term=QUERY.safeParse(query);
  if(!selected.success||!term.success||!Array.isArray(rows))return [];
  const allowed=TYPES[selected.data];
  const search=normalized(term.data),output=[],seen=new Set();
  const cap=Math.min(36,Math.max(1,Number.isInteger(limit)?limit:24));
  for(const row of rows){
    const source=typeof row==='string'?{type:'pattern',title:row}:row;
    if(!source||typeof source!=='object')continue;
    // Legacy time storage uses "anchor"; its *suggestion* is a date.
    // Spatial legacy rows use "space_anchor"; never rewrite stored values.
    const rawType=source.type||source.trace_type;
    const type=rawType==='anchor'?'date':rawType==='space_anchor'?'point':rawType;
    if(!allowed.has(type))continue;
    const parsed=CANDIDATE.safeParse({
      type,title:source.title??source.name,
      ...(source.uid?{uid:source.uid}:{})
    });
    if(!parsed.success)continue;
    const item=parsed.data;
    if(search&&!normalized(item.title).includes(search)&&!normalized(item.uid||'').includes(search))continue;
    const key=item.type+':'+(item.uid||item.title);
    if(seen.has(key))continue;
    seen.add(key);output.push(item);
    if(output.length>=cap)break;
  }
  return output;
}
