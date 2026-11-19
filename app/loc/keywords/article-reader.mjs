// Read complete timestamp groups so pagination never depends on the arbitrary
// order of articles sharing a publication time. UID is not an ordering key.
const text=value=>String(value??'');
const timeOrder=(a,b)=>text(a.createtime).localeCompare(text(b.createtime));

export function createChronologicalKeywordReader({readTimePage,readTimePeers,readUndated,maximumRows=10000}={}){
  if([readTimePage,readTimePeers,readUndated].some(read=>typeof read!=='function'))
    throw new TypeError('Chronological keyword reader needs all three data sources');
  if(!Number.isSafeInteger(maximumRows)||maximumRows<1)
    throw new TypeError('maximumRows must be positive');
  let lastCompleteTime=null,timeDone=false,undatedDone=false;
  const pending=[];
  return async function readPage({limit}={}){
    if(!Number.isSafeInteger(limit)||limit<1)throw new TypeError('Invalid article page size');
    while(pending.length<limit&&(!timeDone||!undatedDone)){
      if(!timeDone){
        const page=await readTimePage({after:lastCompleteTime,limit});
        if(!Array.isArray(page)||page.length>limit)
          throw new Error('Invalid chronological article page');
        if(!page.length){timeDone=true;continue}
        if(page.some(row=>!row?.createtime))
          throw new Error('Unexpected article without publication time');
        const boundary=text(page[page.length-1].createtime);
        if(lastCompleteTime!==null&&boundary<=lastCompleteTime)
          throw new Error('Article publication time cursor did not advance');
        const peers=await readTimePeers({createtime:boundary,maximumRows});
        if(!Array.isArray(peers)||peers.length>=maximumRows||!peers.length||
          peers.some(row=>text(row?.createtime)!==boundary))
          throw new Error('Incomplete publication-time group; no analysis results were written');
        pending.push(...page.filter(row=>text(row.createtime)!==boundary),...peers);
        pending.sort(timeOrder);
        lastCompleteTime=boundary;
      }else{
        const rows=await readUndated({maximumRows});
        if(!Array.isArray(rows)||rows.length>=maximumRows||rows.some(row=>row?.createtime!=null))
          throw new Error('Incomplete undated article group; no analysis results were written');
        pending.push(...rows);
        undatedDone=true;
      }
    }
    return pending.splice(0,limit);
  };
}


// Full-scope Pattern scanning follows the already-indexed Galaxy.date
// order. The matching engine records unique Galaxy UIDs per Pattern, so
// repeat scans of the same day are harmless. Publication time is not an
// ordering key for a literal scan and must not trigger whole-day buffering.
export function createIndexedDateKeywordReader({
  readDateBatch,readUndatedBatch
}={}){
  if(typeof readDateBatch!=='function'||typeof readUndatedBatch!=='function')
    throw new TypeError('Indexed date reader needs dated and undated page readers');
  const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9]{8}$/.test(uid);
  const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day);
  const dateTime=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  });
  const canonicalDay=value=>{
    if(validDay(value))return value;
    const serialized=value instanceof Date?value.toISOString():value;
    if(typeof serialized!=='string')return null;
    const millis=Date.parse(serialized);
    if(!Number.isFinite(millis))return null;
    const stamp=new Date(millis);
    // pg DATE can arrive as UTC midnight or Taiwan midnight in UTC.
    if(stamp.getUTCMinutes()!==0||stamp.getUTCSeconds()!==0||
      stamp.getUTCMilliseconds()!==0)return null;
    if(stamp.getUTCHours()===0)return stamp.toISOString().slice(0,10);
    if(stamp.getUTCHours()===16)return dateTime.format(stamp);
    return null;
  };
  const fresh=()=>({phase:'dated',lastDate:null,lastUid:null});
  const validState=state=>state&&typeof state==='object'&&
    ['dated','undated','done'].includes(state.phase)&&
    (state.lastDate===null||validDay(state.lastDate))&&
    (state.lastUid===null||validUid(state.lastUid));
  return async function readPage({cursor=null,limit}={}){
    if(!Number.isSafeInteger(limit)||limit<1)
      throw new TypeError('Invalid article page size');
    const state=cursor??fresh();
    if(!validState(state))throw new Error('Invalid Galaxy scan cursor');
    if(state.phase==='done')return {rows:[],nextCursor:state};
    if(state.phase==='dated'){
      const raw=await readDateBatch({
        afterDate:state.lastDate,afterUid:state.lastUid,limit
      });
      if(!Array.isArray(raw)||raw.length>limit)
        throw new Error('Invalid dated Galaxy scan page');
      if(raw.length){
        let lastDate=state.lastDate,lastUid=state.lastUid;
        for(const row of raw){
          const date=canonicalDay(row?.date),uid=String(row?.uid||'');
          if(!validDay(date)||!validUid(uid)||
            lastDate!==null&&(date<lastDate||
              date===lastDate&&uid<=lastUid))
            throw new Error('Invalid date/UID Galaxy scan cursor order');
          lastDate=date;lastUid=uid;
        }
        return {rows:raw,nextCursor:{phase:'dated',lastDate,lastUid}};
      }
      // An empty indexed date page is not the end of the Scope: undated
      // articles remain reachable through a direct UID cursor.
      const undated=await readUndatedBatch({afterUid:null,limit});
      if(!Array.isArray(undated)||undated.length>limit)
        throw new Error('Invalid undated Galaxy scan page');
      if(!undated.length)return {rows:[],nextCursor:{phase:'done',lastDate:null,lastUid:null}};
      for(let i=0;i<undated.length;i++)
        if(!validUid(undated[i]?.uid)||undated[i]?.date!=null||
          i>0&&undated[i].uid<=undated[i-1].uid)
          throw new Error('Invalid undated Galaxy scan cursor order');
      return {rows:undated,nextCursor:{
        phase:'undated',lastDate:null,lastUid:undated.at(-1).uid
      }};
    }
    const undated=await readUndatedBatch({afterUid:state.lastUid,limit});
    if(!Array.isArray(undated)||undated.length>limit)
      throw new Error('Invalid undated Galaxy scan page');
    if(!undated.length)return {rows:[],nextCursor:{phase:'done',lastDate:null,lastUid:null}};
    let lastUid=state.lastUid;
    for(const row of undated){
      if(!validUid(row?.uid)||row.date!=null||row.uid<=lastUid)
        throw new Error('Invalid undated Galaxy scan cursor order');
      lastUid=row.uid;
    }
    return {rows:undated,nextCursor:{phase:'undated',lastDate:null,lastUid}};
  };
}
