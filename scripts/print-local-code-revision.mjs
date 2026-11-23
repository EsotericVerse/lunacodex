// Show the exact locally checked-out source revision before Next dev starts.
// "origin/main" means the last fetched tracking ref; this script never fetches.
import {spawnSync} from 'node:child_process';

function git(...args){
  const result=spawnSync('git',args,{encoding:'utf8',windowsHide:true});
  return result.status===0?result.stdout.trim():null;
}

const head=git('rev-parse','--verify','HEAD');
if(!head){
  console.log('[loc-code] Git commit unavailable (running outside a Git checkout).');
}else{
  const branch=git('symbolic-ref','--quiet','--short','HEAD')||'(detached HEAD)';
  console.log('[loc-code] Local branch: '+branch);
  console.log('[loc-code] Local HEAD: '+head);
  const remote=git('rev-parse','--verify','refs/remotes/origin/main');
  if(remote){
    const divergence=git('rev-list','--left-right','--count','HEAD...refs/remotes/origin/main');
    const counts=divergence?.split(/\s+/).map(Number);
    let relation='cannot calculate divergence';
    if(counts?.length===2&&counts.every(Number.isFinite)){
      const [ahead,behind]=counts;
      relation=ahead===0&&behind===0?'same commit'
        :ahead===0?'behind by '+behind+' commit(s)'
        :behind===0?'ahead by '+ahead+' commit(s)'
        :'diverged (ahead '+ahead+', behind '+behind+')';
    }
    console.log('[loc-code] origin/main (last fetched): '+remote);
    console.log('[loc-code] Local vs last fetched main: '+relation);
  }else{
    console.log('[loc-code] origin/main tracking ref not found.');
  }
  const dirty=git('status','--porcelain','--untracked-files=no');
  if(dirty!==null&&dirty!=='')console.log('[loc-code] Tracked working files have uncommitted changes.');
}
