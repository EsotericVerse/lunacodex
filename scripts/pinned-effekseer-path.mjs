import path from 'node:path';

// Keep authored effects under the pinned collection on Windows and POSIX.
// Path-relative validation rejects sibling directory prefixes and traversal.
export function resolvePinnedEffekseerTarget(root,name,pathApi=path){
  const invalid=()=>new Error('Unsafe Effekseer asset path: '+name);
  if(typeof name!=='string'||!name||pathApi.isAbsolute(name))throw invalid();
  const target=pathApi.resolve(root,name);
  const local=pathApi.relative(root,target);
  if(!local||local==='..'||local.startsWith('..'+pathApi.sep)||pathApi.isAbsolute(local))
    throw invalid();
  return target;
}
