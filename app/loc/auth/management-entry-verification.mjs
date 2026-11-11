// A protected entry must settle as verified, denied or failed. Returning a
// permanently pending client-query state is not a valid authorization outcome.
export async function verifyManagementEntry(refresh,{timeoutMs=30000}={}){
  if(typeof refresh!=='function')throw Error('管理權限核驗函式不存在');
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(refresh),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('管理權限核驗逾時；LOC Auth 身分或 Scope 授權沒有回應，請檢查授權服務。')),timeoutMs);
      })
    ]);
  }finally{clearTimeout(timer);}
}
