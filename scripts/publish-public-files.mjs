import fs from 'node:fs';
import path from 'node:path';

// Explicit publishing happens outside normal builds. Stage first and restore
// previously published files if an install step throws.
export function publishPublicFiles(root,entries){
  const temp=fs.mkdtempSync(path.join(root,'.loc-public-stage-'));
  const stage=path.join(temp,'stage'),backup=path.join(temp,'backup');
  const install=entries.map(([file])=>file);
  const moved=[];
  try{
    for(const [file,content] of entries){
      const dst=path.resolve(stage,file);
      if(!dst.startsWith(stage+path.sep)||typeof content!=='string')
        throw Error('Invalid published file: '+file);
      fs.mkdirSync(path.dirname(dst),{recursive:true});
      fs.writeFileSync(dst,content,'utf8');
    }
    for(const file of install){
      const dest=path.resolve(root,file);
      const staged=path.resolve(stage,file);
      const saved=path.resolve(backup,file);
      if(!dest.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(staged))
        throw Error('Invalid publication target: '+file);
      const item={dest,saved,hadOld:false,installed:false};
      moved.push(item);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      if(fs.existsSync(dest)){
        fs.mkdirSync(path.dirname(saved),{recursive:true});
        fs.renameSync(dest,saved);
        item.hadOld=true;
      }
      fs.renameSync(staged,dest);
      item.installed=true;
    }
  }catch(error){
    const failures=[];
    for(const item of moved.reverse()){
      try{
        if(item.installed)fs.rmSync(item.dest,{recursive:true,force:true});
        if(item.hadOld)fs.renameSync(item.saved,item.dest);
      }catch(rollback){failures.push(rollback);}
    }
    if(failures.length)throw new AggregateError([error,...failures],'Public snapshot install and rollback failed');
    throw error;
  }finally{
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
