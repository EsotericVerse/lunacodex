// Bounded write-time source ZModel validation; never changes the raw payload.
// A single synchronous parse of 100k records starved the React main thread.
// Yield only between records, never during one Zod validation or SQL write.
const defaultYield=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function assertSourceImportRowsInSlices(rows,source,assertRow,{
  onProgress,yieldControl=defaultYield
}={}){
  if(!Array.isArray(rows)||typeof assertRow!=='function')
    throw new TypeError('來源 ZModel 驗證資料無效');
  const total=rows.length;
  for(let index=0;index<total;index++){
    const raw=rows[index]?.raw||rows[index]||{};
    assertRow(raw,source,index+1);
    if((index+1)%256===0||index+1===total){
      onProgress?.({completed:index+1,total});
      if(index+1<total)await yieldControl();
    }
  }
  return rows;
}
