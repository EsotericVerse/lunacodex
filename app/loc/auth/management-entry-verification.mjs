// A protected entry must settle as verified, denied or failed. Returning a
// permanently pending SWR state is not a valid authorization outcome.
export async function verifyManagementEntry(refresh,{timeoutMs=12000}={}){
  if(typeof refresh!=='function')throw Error('管理權限核驗函式不存在');
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(refresh),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('管理權限核驗逾時；LOC Auth Session 或 SQL Gateway未完成回應。請重新確認管理權限。')),timeoutMs);
      })
    ]);
  }finally{clearTimeout(timer);}
}
