#!/usr/bin/env node
/**
 * LOC emergency release live evidence gate. It only reads Cloudflare and
 * GitHub security data, never changes scopes, secrets, workers or tokens.
 * The single EXISTING LRS Worker must remain lunarunes.
 *
 * A signed request alone is not security evidence: independently check the
 * CURRENT Worker version, public critical GitHub advisory, the vulnerable
 * pinned package-lock, and the remediated pinned package-lock. Fail closed
 * if any evidence or permissions are unavailable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyLrsEmergencyAuthorization} from './lrs-emergency-authorization.mjs';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const runnerRoot=process.cwd();
const source=path.join(runnerRoot,'rune-source');
const context=JSON.parse(process.env.LOC_LRS_EMERGENCY_REQUEST||'null');
const maxTtlSeconds=process.env.LOC_EMERGENCY_MAX_TTL_SECONDS?
  Number(process.env.LOC_EMERGENCY_MAX_TTL_SECONDS):21600;

export function auditContainsGhsa(audit,id){
  if(!audit||typeof audit!=='object'||audit.error)throw Error('npm audit result unavailable');
  return Object.values(audit.vulnerabilities||{}).some(value=>
    Array.isArray(value?.via)&&value.via.some(item=>
      item&&typeof item==='object'&&typeof item.url==='string'&&
      item.url.toUpperCase().includes(id.toUpperCase())
    )
  );
}
export function assertCriticalAdvisory(advisory,id){
  if(advisory?.ghsa_id!==id||advisory?.severity!=='critical'||
    advisory?.withdrawn_at||!advisory?.published_at)
    throw Error('No confirmed published critical GitHub advisory');
  return true;
}
export function assertWorkerVersion(versions,request,phase){
  if(!Array.isArray(versions))throw Error('Cloudflare Worker deployments unavailable');
  const deployed=versions[0]?.versions?.[0]?.version_id||null;
  if(phase==='after'){
    if(!deployed||deployed===request.workerVersionId)
      throw Error('LRS emergency deployment did not publish a new Worker version');
  }else if(request.reason==='bootstrap'){
    if(deployed)throw Error('LRS baseline exists; emergency bootstrap is forbidden');
  }else if(!deployed||deployed!==request.workerVersionId){
    throw Error('LRS Worker deployment changed or is unverifiable: refuse replay/overwrite');
  }
  return deployed;
}
async function jsonAt(url,headers={}){
 const response=await fetch(url,{headers});
 if(!response.ok)throw Error('Remote evidence HTTP '+response.status);
 return response.json();
}
async function workerVersions(){
 if(!/^[a-f0-9]{32}$/.test(account||'')||!token)
   throw Error('Existing Cloudflare account or API credential unavailable; no grant attempted');
 const d=await jsonAt('https://api.cloudflare.com/client/v4/accounts/'+account+
   '/workers/scripts/lunarunes/deployments',{
    Authorization:'Bearer '+token,'Accept':'application/json'
   });
 if(d.success!==true)throw Error('Cannot verify current Cloudflare LRS Worker');
 return d.result?.deployments||[];
}
function gitShow(sha,name){
 const result=execFileSync('git',['-C',source,'show',sha+':'+name],{
  encoding:'utf8',maxBuffer:16*1024*1024
 });
 if(!result)throw Error('Missing pinned LRS dependency manifest: '+name);
 return result;
}
/** No tracked LRS package-lock exists yet. A live emergency must prove
 * the patched commit deliberately changes a dependency and must audit the
 * resolved dependency tree, never assume an unchanged floating tree is fixed.
 * This is a conservative temporary proof until LRS begins pinning lockfiles.
 */
export function changedDirectDependencies(oldManifest,newManifest){
 const oldDeps={...oldManifest.dependencies,...oldManifest.devDependencies};
 const newDeps={...newManifest.dependencies,...newManifest.devDependencies};
 return Object.keys(newDeps).filter(name=>
   Object.hasOwn(oldDeps,name)&&oldDeps[name]!==newDeps[name]);
}
function auditAt(sha){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'loc-lrs-audit-'));
 try{
   fs.writeFileSync(path.join(tmp,'package.json'),gitShow(sha,'package.json'));
   const env={...process.env};
   delete env.CLOUDFLARE_API_TOKEN;
   delete env.LOC_LRS_EMERGENCY_REQUEST;
   // Generate an audit-only dependency resolution from THIS pinned manifest,
   // not a mutable checked-out working directory. No scripts are executed.
   execFileSync('npm',['install','--package-lock-only','--ignore-scripts','--no-fund','--no-audit'],{
     cwd:tmp,env,encoding:'utf8',maxBuffer:20*1024*1024
   });
   if(!fs.existsSync(path.join(tmp,'package-lock.json')))
     throw Error('Cannot independently resolve LRS pinned dependencies');
   let output;
   try{
     output=execFileSync('npm',['audit','--json'],{
       cwd:tmp,env,encoding:'utf8',maxBuffer:20*1024*1024
     });
   }catch(error){
     if(!error.stdout)throw Error('npm audit evidence unavailable');
     output=error.stdout;
   }
   let parsed;
   try{parsed=JSON.parse(output);}catch{throw Error('Invalid npm audit evidence');}
   if(parsed.error)throw Error('npm audit registry evidence unavailable');
   return parsed;
 }finally{
   fs.rmSync(tmp,{recursive:true,force:true});
 }
}
async function main(){
 const phase=process.argv[2];
 if(!['before','after'].includes(phase))throw Error('Usage: attest-lrs-emergency.mjs before|after');
 const request=context?.request;
 verifyLrsEmergencyAuthorization({
   request,signature:context?.signature,secret:token,
   now:Date.now(),maxTtlSeconds,
   approvedMajorSha:process.env.LRS_MAJOR_RELEASE_APPROVED_SHA||''
 });
 const versions=await workerVersions();
 assertWorkerVersion(versions,request,phase);
 if(phase==='after'){
   console.log('[lrs-emergency] Existing Worker changed version; no LOC, LAS, IPA changes');
   return;
 }
 if(request.reason==='security'){
   const advisory=await jsonAt('https://api.github.com/advisories/'+
     encodeURIComponent(request.advisoryId),{
       'Accept':'application/vnd.github+json',
       'User-Agent':'LOC-LRS-emergency-attestation'
     });
   assertCriticalAdvisory(advisory,request.advisoryId);
   const oldManifest=JSON.parse(gitShow(request.deployedSha,'package.json'));
   const patchedManifest=JSON.parse(gitShow(request.desiredSha,'package.json'));
   const changed=changedDirectDependencies(oldManifest,patchedManifest);
   const advisoryPackages=(advisory.vulnerabilities||[])
     .map(x=>x.package?.name).filter(Boolean);
   if(!changed.some(name=>advisoryPackages.includes(name)))
     throw Error('Target commit does not update the affected LRS dependency');
   const before=auditAt(request.deployedSha);
   const after=auditAt(request.desiredSha);
   if(!auditContainsGhsa(before,request.advisoryId)||
      auditContainsGhsa(after,request.advisoryId)||
      (after.metadata?.vulnerabilities?.critical||0)!==0)
     throw Error('The pinned LRS source is not proven to remediate the critical vulnerability');
 }else if(request.reason==='major'){
   // Major release is owner-approved by its exact SHA. No dependency advisory
   // or missing-baseline claim is fabricated for ordinary version publishing.
   if(request.desiredSha!==process.env.LRS_MAJOR_RELEASE_APPROVED_SHA)
     throw Error('Major release approval changed or was revoked');
 }else{
   // A missing production must not mean a missing Worker. Never create one.
   const result=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+
     '/workers/scripts/lunarunes',{headers:{Authorization:'Bearer '+token}});
   if(!result.ok)throw Error('Missing existing LRS Worker: new Worker creation is forbidden');
   if((auditAt(request.desiredSha).metadata?.vulnerabilities?.critical||0)!==0)
     throw Error('LRS bootstrap source contains critical dependency advisories');
 }
 console.log('[lrs-emergency] Verified current Worker and exact pinned source; no grant issued');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{
  console.error('[lrs-emergency] refused: '+error.message);
  process.exitCode=1;
 });
