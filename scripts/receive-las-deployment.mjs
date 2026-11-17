// Trusted GitHub Actions repository_dispatch receiver. Does not modify LAS/LRS.
// Durable receipts live on a separate LOC state branch, never LOC main.
import {appendFileSync} from 'node:fs';
import {
  verifyLasNotification,hasPublishedLasCheck,receiptPath,validateLocPagesHook,
  LAS_REPO,LOC_REPO,STATE_BRANCH,EVENT
} from './las-deploy-authorization.mjs';
const payload=JSON.parse(process.env.LOC_LAS_NOTIFICATION||'null');
const request=verifyLasNotification(payload,process.env.LOC_WORKFLOW_KEY);
const token=process.env.GH_TOKEN||'';
if(!token)throw Error('Missing LOC GitHub Actions identity');
const root='https://api.github.com/repos/';
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28','User-Agent':'LOC-LAS-deployment-verify'};
async function api(path,{method='GET',body,allow404=false}={}){
  const r=await fetch(root+path,{method,redirect:'error',headers:{
    ...headers,...(body?{'content-type':'application/json'}:{})
  },body:body?JSON.stringify(body):undefined});
  if(allow404&&r.status===404)return null;
  if(!r.ok)throw Error('GitHub verification/state HTTP '+r.status);
  if(r.status===204)return {};
  return r.json();
}
const ref=await api(LAS_REPO+'/git/ref/heads/main');
if(ref.object?.sha!==request.sha)throw Error('LAS source changed since published notification');
const check=await api(LAS_REPO+'/commits/'+request.sha+'/check-runs?per_page=100');
if(!hasPublishedLasCheck(check.check_runs))
  throw Error('LAS main has no verified successful Cloudflare production build');
const current=await api(LOC_REPO+'/git/ref/heads/main');
if(!/^[a-f0-9]{40}$/.test(current.object?.sha||''))
  throw Error('LOC main source cannot be verified');
let receiptBranch=await api(LOC_REPO+'/git/ref/heads/'+STATE_BRANCH,{allow404:true});
if(!receiptBranch){
  await api(LOC_REPO+'/git/refs',{method:'POST',body:{
    ref:'refs/heads/'+STATE_BRANCH,sha:current.object.sha
  }});
  receiptBranch=await api(LOC_REPO+'/git/ref/heads/'+STATE_BRANCH);
}
const path=receiptPath(request);
const received=await api(LOC_REPO+'/contents/'+path+'?ref='+STATE_BRANCH,{allow404:true});
if(received){
  console.log('LOC already accepted LAS published version '+request.version+'; skip repeat Pages build');
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'decision=skip\n');
  process.exit(0);
}
// Do not silently succeed without a working LOC-owned release hook.
const hook=validateLocPagesHook(process.env.LOC_PAGES_DEPLOY_HOOK||'');
const response=await fetch(hook,{method:'POST',redirect:'error'});
if(!response.ok)throw Error('LOC-owned Pages deployment trigger HTTP '+response.status);
// Record only successful request acceptance. An interrupted run before this write
// could retry: exactly-once cannot be guaranteed without transactional Pages API.
await api(LOC_REPO+'/contents/'+path,{method:'PUT',body:{
  message:'chore(loc): record LAS contract notification '+request.version,
  branch:STATE_BRANCH,
  content:Buffer.from(JSON.stringify({
    schema:request.schema,lasSha:request.sha,version:request.version,
    locSha:current.object.sha,receivedAt:new Date().toISOString()
  },null,2)+'\n').toString('base64')
}});
if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'decision=triggered\n');
console.log('LOC accepted validated LAS '+request.sha+' / '+request.version+
  '; requested one LOC-owned Cloudflare Pages main build');
