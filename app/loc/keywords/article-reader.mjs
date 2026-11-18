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


// Prefer the existing Galaxy.date B-tree rather than repeatedly sorting the
// complete table by the unindexed createtime timestamp. This reader preserves
// chronological scoring and the existing least-populated-Group tie behavior.
// A date/canonical timestamp mismatch fails BEFORE any Keyword results write.
export function createIndexedDateKeywordReader({
  readDateBatch,readUndated,maximumRows=10000
}={}){
  if(typeof readDateBatch!=='function'||typeof readUndated!=='function')
    throw new TypeError('Indexed date reader requires batched date and undated readers');
  if(!Number.isSafeInteger(maximumRows)||maximumRows<1)
    throw new TypeError('maximumRows must be positive');
  const dateTime=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  });
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
  const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9]{8}$/.test(value);
  // A SQL DATE is a calendar day, not the publication timestamp. Drivers
  // can return either an ISO day or midnight UTC/Taipei as a Date.
  const canonicalDay=value=>{
    if(validDay(value))return value;
    const serialized=value instanceof Date?value.toISOString():value;
    if(typeof serialized!=='string'||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(serialized))
      return null;
    const stamp=new Date(serialized);
    if(!Number.isFinite(stamp.getTime())||
      stamp.getUTCMinutes()!==0||stamp.getUTCSeconds()!==0||
      stamp.getUTCMilliseconds()!==0)return null;
    if(stamp.getUTCHours()===0)return stamp.toISOString().slice(0,10);
    if(stamp.getUTCHours()===16)return dateTime.format(stamp);
    return null;
  };
  const verifyDated=row=>{
    if(!validDay(row?.date)||!row.createtime||
      !Number.isFinite(new Date(row.createtime).getTime())||
      dateTime.format(new Date(row.createtime))!==row.date)
      throw new Error('Galaxy 日期與發表時間不一致，未寫入分析結果');
  };
  // No closure-held position any more: everything readPage needs to continue
  // from exactly where a PRIOR call (possibly in an earlier HTTP request)
  // left off travels in `cursor`, and the same shape comes back as
  // `nextCursor`. This includes rows already fetched and verified from the
  // DB but not yet handed to the caller (`pending`/`currentDay`) — dropping
  // those on a resume would silently skip real articles, not just redo work,
  // so they are part of the resumable state, not an internal-only detail.
  const freshState=()=>({lastDate:null,lastUid:null,datedDone:false,
    undatedDone:false,pending:[],currentDay:[]});
  const validState=state=>state&&typeof state==='object'&&!Array.isArray(state)&&
    (state.lastDate===null||validDay(state.lastDate))&&
    (state.lastUid===null||validUid(state.lastUid))&&
    typeof state.datedDone==='boolean'&&typeof state.undatedDone==='boolean'&&
    Array.isArray(state.pending)&&Array.isArray(state.currentDay);
  // UID is only a physical SQL cursor. Semantic order within a day remains
  // publication time (and deterministic UID for equal timestamps).
  const sortDay=rows=>[...rows].sort((a,b)=>
    timeOrder(a,b)||text(a.uid).localeCompare(text(b.uid)));
  return async function readPage({cursor,limit}={}){
    if(!Number.isSafeInteger(limit)||limit<1)
      throw new TypeError('Invalid article page size');
    if(cursor!=null&&!validState(cursor))
      throw new Error('Invalid Galaxy reader resume cursor');
    let {lastDate,lastUid,datedDone,undatedDone}=cursor??freshState();
    const pending=cursor?[...cursor.pending]:[];
    let currentDay=cursor?[...cursor.currentDay]:[];
    while(pending.length<limit&&(!datedDone||!undatedDone)){
      if(!datedDone){
        // limit already carries the caller's fully dynamic page size (no
        // ceiling by design, see incremental.mjs MAX_PAGE_ROWS); re-capping
        // it to 1000 here would silently undo that and freeze every SQL
        // read at the old fixed size regardless of measured performance.
        const batchLimit=limit;
        const raw=await readDateBatch({afterDate:lastDate,afterUid:lastUid,
          limit:batchLimit});
        if(!Array.isArray(raw)||raw.length>batchLimit)
          throw new Error('Galaxy 日期分頁格式無效');
        if(!raw.length){
          datedDone=true;pending.push(...sortDay(currentDay));currentDay=[];
          continue;
        }
        for(const original of raw){
          const row={...original,date:canonicalDay(original?.date)};
          const uid=text(row.uid),day=row.date;
          if(!validUid(uid)||!validDay(day)||
            lastDate!==null&&(day<lastDate||
              day===lastDate&&uid<=lastUid))
            throw new Error('Galaxy 日期/UID 游標排序不完整，未寫入分析結果');
          verifyDated(row);
          if(currentDay.length&&currentDay[0].date!==day){
            pending.push(...sortDay(currentDay));currentDay=[];
          }
          currentDay.push(row);
          if(currentDay.length>=maximumRows)
            throw new Error('Galaxy 同日文章超過完整資料範圍，未寫入分析結果');
          lastDate=day;lastUid=uid;
        }
        if(raw.length<batchLimit){
          datedDone=true;pending.push(...sortDay(currentDay));currentDay=[];
        }
        continue;
      }
      const group=await readUndated({maximumRows});
      const undated=group?.rows,count=group?.count;
      if(!Array.isArray(undated)||!Number.isSafeInteger(count)||
        count<0||count>=maximumRows||undated.length!==count||
        undated.some(row=>row?.date!=null||!validUid(row?.uid)||
          row.createtime!=null&&!Number.isFinite(new Date(row.createtime).getTime())))
        throw new Error('Galaxy 無日期文章分頁不完整，未寫入分析結果');
      // A record can have a real publication timestamp without a derived
      // calendar date. Preserve its data; do not reject valid imported rows.
      pending.push(...sortDay(undated));
      undatedDone=true;
    }
    const rows=pending.splice(0,limit);
    return {rows,nextCursor:{lastDate,lastUid,datedDone,undatedDone,pending,currentDay}};
  };
}
