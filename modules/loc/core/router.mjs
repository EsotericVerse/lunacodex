// Route matching belongs to LOC; the host may be a static publisher or server.
const VALID=/^\/(?:[a-z0-9_:-]+\/)*$/i;
export function canonicalPath(path){
  if(typeof path!=='string'||!path.startsWith('/'))
    throw new TypeError('LOC route must be an absolute path');
  const normalized='/'+path.split('/').filter(Boolean).join('/')+(path==='/'?'':'/');
  if(!VALID.test(normalized))throw new TypeError('Invalid LOC route: '+path);
  return normalized;
}
export function createRouter(){
  const routes=[];
  return Object.freeze({
    register(path,view,{title='',description='',privateRoute=false}={}){
      const canonical=canonicalPath(path);
      if(typeof view!=='function')throw new TypeError('LOC route needs a view factory');
      const names=canonical.split('/').filter(Boolean).filter(x=>x.startsWith(':'));
      if(new Set(names).size!==names.length)throw new TypeError('Duplicate LOC route parameter');
      if(routes.some(r=>r.path===canonical))throw new Error('Duplicate LOC route');
      routes.push(Object.freeze({path:canonical,view,title,description,privateRoute}));
    },
    resolve(pathname){
      const path=canonicalPath(pathname.split('?')[0].split('#')[0]);
      const segments=path.split('/').filter(Boolean);
      for(const route of routes){
        const expected=route.path.split('/').filter(Boolean);
        if(expected.length!==segments.length)continue;
        const params=Object.create(null);
        let match=true;
        for(let i=0;i<expected.length;i++){
          const part=expected[i];
          if(part.startsWith(':'))params[part.slice(1)]=segments[i];
          else if(part!==segments[i]){match=false;break;}
        }
        if(match)return {route,params};
      }
      return null;
    },
    list(){return routes.map(({path,title,description,privateRoute})=>({path,title,description,privateRoute}));}
  });
}
