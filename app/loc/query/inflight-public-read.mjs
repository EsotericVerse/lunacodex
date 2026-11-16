// Share identical pending anonymous SELECTs; never cache completed results.
// The caller must bypass this helper for authenticated or cancellable requests.
export const MAX_INFLIGHT_PUBLIC_READS=128;
const pending=new Map();
export function coalescePendingPublicRead(key,request){
  const existing=pending.get(key);
  if(existing)return existing;
  if(pending.size>=MAX_INFLIGHT_PUBLIC_READS)return Promise.resolve().then(request);
  const task=Promise.resolve().then(request);
  pending.set(key,task);
  const release=()=>{if(pending.get(key)===task)pending.delete(key);};
  task.then(release,release);
  return task;
}
