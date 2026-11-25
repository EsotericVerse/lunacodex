// Canonical Pattern vocabulary and per-Item rules. Item keeps only graph edges
// and aggregate totals. Project editor words from Pattern without storing them.
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
export const keywordIdentity=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export const keywordAttr=row=>typeof row?.attr==='string'?JSON.parse(row.attr):row?.attr||{};
export const patternChildren=row=>Array.isArray(keywordAttr(row).uid)?keywordAttr(row).uid:[];
const UID=/^[A-Za-z0-9]{8}$/;
const fail=message=>{throw Object.assign(Error(message),{httpStatus:409});};
export function projectPatternWords(item,patterns){
  const byId=patterns instanceof Map?patterns:new Map(patterns.map(p=>[p.uid,p]));
  const words=[],seen=new Set();
  const push=value=>{if(value&&!seen.has(value)){seen.add(value);words.push(value);}};
  for(const uid of patternChildren(item)){
    const pattern=byId.get(uid);
    if(!pattern)fail('Keyword Pattern relationship incomplete');
    const link=keywordAttr(pattern).items?.[item.uid];
    if(!link||typeof link!=='object'||Array.isArray(link))
      fail('Keyword Pattern Item rule relationship incomplete');
    const word=String(pattern.title||'').trim();
    if(!word)fail('Keyword Pattern has no literal');
    if(link.literal===true||link.positive===true||link.negative===true||link.label===true)push(word);
    for(const rule of link.rules||[]){
      if(!['TO','AND','NAME','NOR'].includes(rule.operator))fail('Unsupported Keyword Pattern rule');
      if(rule.operator!=='NAME'&&!rule.target)fail('Keyword Pattern rule has no target');
      push(word+rule.operator+(rule.operator==='NAME'?'':rule.target));
    }
  }
  return words;
}
export async function readItemPatternRows(db,anchor,items,{all=false}={}){
  const uids=[...new Set(items.flatMap(patternChildren))].sort();
  if(uids.some(uid=>!UID.test(String(uid))))fail('Invalid Keyword Pattern UID');
  if(!all&&!uids.length)return [];
  let q=db.selectFrom(anchor).select(['uid','title','attr']).where('type','=','pattern');
  if(!all)q=q.where('uid','in',uids);
  const rows=await q.orderBy('uid','asc').execute();
  const byId=new Map(rows.map(row=>[row.uid,row]));
  for(const uid of uids)if(!byId.has(uid))fail('Keyword Pattern relationship incomplete');
  return rows;
}
// Rules in the existing editor are a transient text representation. Preserve
// Excel direction flags and manual notes when a surviving word is edited.
export function planItemPatternLinks(itemName,words=[],oldLinks=new Map()){
  const result=new Map();
  const ensure=word=>{
    const title=String(word??'').normalize('NFKC').trim(),key=keywordIdentity(title);
    if(!key)fail('Empty Keyword Pattern');
    if(!result.has(key))result.set(key,{title,link:{rules:[]}});
    return result.get(key).link;
  };
  for(const raw of words){
    const parsed=parseRuneKeywordRuleSentence(raw);
    if(!parsed.rules.length){const link=ensure(raw);const old=oldLinks.get(keywordIdentity(raw))||{};
      if(old.positive===true)link.positive=true;
      if(old.negative===true)link.negative=true;
      if(!link.positive&&!link.negative)link.literal=true;
      continue;
    }
    for(const rule of parsed.rules){const link=ensure(rule.source);
      if(!link.rules.some(r=>r.operator===rule.operator&&r.target===rule.target))
        link.rules.push({operator:rule.operator,target:rule.target});
    }
    for(const note of parsed.notes)ensure(note).literal=true;
  }
  ensure(itemName).label=true;
  for(const [key,{link}] of result){
    const old=oldLinks.get(key);
    if(Array.isArray(old?.notes)&&old.notes.length)link.notes=[...old.notes];
    if(Array.isArray(old?.remarks)&&old.remarks.length)link.remarks=[...old.remarks];
  }
  return result;
}
