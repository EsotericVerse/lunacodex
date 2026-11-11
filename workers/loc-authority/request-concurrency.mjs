// Transport admission only: never revokes issuer JWKS, Sessions or OAuth keys.
// This protects a single Cloudflare Worker isolate against burst fan-out.
// Counters in this module are NOT shared across isolates; it is NOT a global
// security/blacklist authority. Global QoS needs independently approved shared
// coordination and must never be represented by this module.
const DEFAULTS=Object.freeze({
  maxInFlight:128,
  perSource:Object.freeze({oauth:24,session:48,metadata:96,other:32})
});
export function requestClass(path=''){
  if(path==='/api/auth/jwks'||path==='/.well-known/jwks.json'||
    path.startsWith('/.well-known/'))return 'metadata';
  if(path==='/api/auth/get-session')return 'session';
  if(path.startsWith('/api/auth/oauth2/')||path==='/api/auth/sign-in/social'||
    path==='/api/auth/callback/google')return 'oauth';
  return 'other';
}
export function createAuthRequestConcurrencyGate(limits=DEFAULTS){
  const inflight=new Map();
  let active=0;
  const sourceCeilings={...DEFAULTS.perSource,...(limits.perSource||{})};
  const totalCeiling=limits.maxInFlight??DEFAULTS.maxInFlight;
  return {
    acquire(request){
      const path=new URL(request.url).pathname;
      const category=requestClass(path);
      // CF-Connecting-IP is supplied by Cloudflare, unlike arbitrary proxy headers.
      const source=request.headers.get('cf-connecting-ip')||'';
      const id=source?category+':'+source:null;
      const count=id?(inflight.get(id)||0):0;
      if(active>=totalCeiling||
        (id&&count>=sourceCeilings[category])){
        return {allowed:false,category,retryAfterSeconds:2};
      }
      active+=1;
      if(id)inflight.set(id,count+1);
      let released=false;
      return {
        allowed:true,category,
        release(){
          if(released)return;
          released=true;
          active-=1;
          if(id){
            const next=(inflight.get(id)||0)-1;
            if(next>0)inflight.set(id,next);
            else inflight.delete(id);
          }
        }
      };
    },
    snapshot(){return {inflight:active,sourceKeys:inflight.size};}
  };
}
export const authRequestConcurrencyGate=createAuthRequestConcurrencyGate();
