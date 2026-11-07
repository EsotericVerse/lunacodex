// Read-only live probe: verify the database owner's existing public API
// accepts the silver schema without using any LOC SQL proxy or Edge Function.
const url='https://qlouywsdiiyiyzpoxyqy.supabase.co/rest/v1/loc?select=id&limit=1';
const key='sb_publishable_qPn0vAzozVyXKllRuEKf2Q_fvG-pLVV';
const response=await fetch(url,{headers:{apikey:key,'accept-profile':'silver'},
  signal:AbortSignal.timeout(10000)});
if(!response.ok){
  const detail=await response.json().catch(()=>null);
  console.error('Public database direct-read unavailable: HTTP '+response.status+
    (detail?.code?' ('+detail.code+')':''));
  process.exitCode=1;
}else console.log('Public database direct-read verified: HTTP '+response.status);
