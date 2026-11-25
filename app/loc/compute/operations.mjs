import {createItemCountAccumulator} from '../keywords/item-count-analysis.mjs';
import {matchExistingImportBySiteId,matchExistingImportByCreatedAt} from '../import/duplicate-check.mjs';
import {COMPUTE_PROTOCOL,validIdentity} from './contract.mjs';

export async function runComputeJob(job){
  if(job?.protocol!==COMPUTE_PROTOCOL)throw Error('Compute protocol mismatch');
  if(job.kind==='keyword'){
    const {items,groups,patterns,minChars,state,rows}=job.payload||{};
    if(![items,groups,patterns,rows].every(Array.isArray)||!state||
      !Number.isSafeInteger(minChars)||minChars<0||rows.length>10000)
      throw Error('Invalid keyword compute input');
    const a=createItemCountAccumulator(items,groups,state,{minChars,patterns});
    if(a.fingerprint!==state.fingerprint)throw Error('Keyword rule revision mismatch');
    a.absorb(rows);
    return a.state;
  }
  if(job.kind==='site'||job.kind==='time'){
    const {incoming,candidates,excluded=[]}=job.payload||{};
    if(!Array.isArray(incoming)||!Array.isArray(candidates)||
      !incoming.every(validIdentity)||!candidates.every(validIdentity)||
      !Array.isArray(excluded)||!excluded.every(uid=>/^[A-Za-z0-9]{8}$/.test(uid)))
      throw Error('Invalid import compute input');
    const siteOf=row=>row.site.trim().toLocaleLowerCase('und');
    const matches=job.kind==='site'
      ?await matchExistingImportBySiteId(incoming,{readSiteIds:async(ids,consume,site)=>{
        const wanted=new Set(ids);
        consume(candidates.filter(row=>siteOf(row)===siteOf({site})&&wanted.has(row.site_id.trim())));
      }})
      :await matchExistingImportByCreatedAt(incoming,{excludeSavedUids:new Set(excluded),
        readSourceRows:async({site,consumePage})=>consumePage(
          candidates.filter(row=>siteOf(row)===siteOf({site})))});
    return {pairs:[...matches].map(([uid,row])=>[uid,String(row.uid)]),
      ambiguous:matches.ambiguous||[]};
  }
  throw Error('Unsupported LOC compute operation');
}
