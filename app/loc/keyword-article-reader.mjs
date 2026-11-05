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
  readDatePage,readDatePeers,readUndated,maximumRows=10000
}={}){
  if([readDatePage,readDatePeers,readUndated].some(read=>typeof read!=='function'))
    throw new TypeError('Indexed date reader requires all three data sources');
  if(!Number.isSafeInteger(maximumRows)||maximumRows<1)
    throw new TypeError('maximumRows must be positive');
  const dateTime=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  });
  let lastDate=null,datedDone=false,undatedDone=false;
  const pending=[];
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
  // SQL DATE may be returned by drivers as midnight UTC or as midnight
  // Asia/Taipei (previous day 16:00 UTC). Neither representation is an
  // article timestamp: recover the calendar day without changing its meaning.
  const canonicalDay=value=>{
    if(validDay(value))return value;
    const serialized=value instanceof Date?value.toISOString():value;
    if(typeof serialized!=='string'||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(serialized))
      return null;
    const instant=new Date(serialized);
    if(!Number.isFinite(instant.getTime()))return null;
    const midnight=instant.getUTCMinutes()===0&&instant.getUTCSeconds()===0&&
      instant.getUTCMilliseconds()===0;
    if(!midnight)return null;
    if(instant.getUTCHours()===0)return instant.toISOString().slice(0,10);
    if(instant.getUTCHours()===16)return dateTime.format(instant);
    return null;
  };
  const normalized=rows=>rows.map(row=>({...row,date:canonicalDay(row?.date)}));
  const verifyDated=row=>{
    if(!row||!validDay(row.date)||!row.createtime)
      throw new Error('Galaxy 日期與發表時間不一致，未寫入分析結果');
    const stamp=new Date(row.createtime);
    if(!Number.isFinite(stamp.getTime())||dateTime.format(stamp)!==row.date)
      throw new Error('Galaxy 日期與發表時間不一致，未寫入分析結果');
  };
  const completeRows=(value,label)=>{
    const rows=value?.rows,count=value?.count;
    if(!Array.isArray(rows)||!Number.isSafeInteger(count)||count<0||
      count>=maximumRows||rows.length!==count)
      throw new Error(label+'分頁不完整，未寫入分析結果');
    return rows;
  };
  return async function readPage({limit}={}){
    if(!Number.isSafeInteger(limit)||limit<1)
      throw new TypeError('Invalid article page size');
    while(pending.length<limit&&(!datedDone||!undatedDone)){
      if(!datedDone){
        const rawPage=await readDatePage({after:lastDate,limit});
        if(!Array.isArray(rawPage)||rawPage.length>limit)
          throw new Error('Galaxy 日期分頁格式無效');
        if(!rawPage.length){datedDone=true;continue;}
        const page=normalized(rawPage);
        const boundary=page.at(-1)?.date;
        if(!validDay(boundary)||lastDate!==null&&boundary<=lastDate||
          page.some(row=>!validDay(row?.date)||
            row.date>boundary||(lastDate!==null&&row.date<=lastDate)))
          throw new Error('Galaxy 日期游標排序不完整，未寫入分析結果'+
            '（前次日期 '+String(lastDate??'起點')+
            '，本頁首日 '+String(page[0]?.date??'無效')+
            '，末日 '+String(boundary??'無效')+
            '，原始末日 '+String(rawPage.at(-1)?.date??'空')+'）');
        const peers=normalized(completeRows(await readDatePeers({date:boundary,maximumRows}),
          'Galaxy 同日文章'));
        if(!peers.length||peers.some(row=>row.date!==boundary))
          throw new Error('Galaxy 同日文章不完整，未寫入分析結果');
        const complete=[...page.filter(row=>row.date!==boundary),...peers];
        for(const row of complete)verifyDated(row);
        pending.push(...complete);
        pending.sort(timeOrder);
        lastDate=boundary;
      }else{
        const undated=completeRows(await readUndated({maximumRows}),
          'Galaxy 無日期文章');
        if(undated.some(row=>row?.date!=null||row?.createtime!=null))
          throw new Error('Galaxy 無日期文章不完整，未寫入分析結果');
        pending.push(...undated);
        undatedDone=true;
      }
    }
    return pending.splice(0,limit);
  };
}
