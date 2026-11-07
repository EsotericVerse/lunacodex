// LOC virtual role hierarchy for ZenStack's @@auth principal.
// Pure projection of an ALREADY verified LOC delegation and trusted registry.
// Group nodes are virtual resources, never User records or a SQL Group table.
export const LOC_ROLE_LEVEL=Object.freeze({guest:0,user:1,scope:2,group:3,admin:4});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const MANAGE=/^([a-z][a-z0-9]{0,14}):manage$/;
const MAX_NODES=4096;

function trustedScopeTree(rows){
  if(!Array.isArray(rows)||rows.length>MAX_NODES)
    throw new Error('Invalid LOC virtual Group registry');
  const nodes=new Map(),children=new Map();
  for(const row of rows){
    const id=String(row?.scope_id||'').toLowerCase();
    const kind=String(row?.scope_kind||'');
    const parent=String(row?.parent_scope_id||'').toLowerCase();
    if(!SCOPE.test(id)||!['group','scope'].includes(kind)||
       parent&&!SCOPE.test(parent)||nodes.has(id))
      throw new Error('Invalid LOC virtual Group registry');
    nodes.set(id,{kind,parent,active:row.active!==false});
  }
  for(const [id,node] of nodes){
    if(!node.parent)continue;
    if(!children.has(node.parent))children.set(node.parent,[]);
    children.get(node.parent).push(id);
  }
  return {nodes,children};
}

/**
 * Project a verified LOC SQL delegation into an ORM-only @@auth value.
 *
 * Caller MUST verify OAuth + LOC JWT signature, audience, expiry and revocation
 * before passing the claims. The optional scopeTree MUST be trusted server-side
 * metadata, never a browser-provided organization tree.
 *
 * This is a policy projection, NOT a replacement for server/Gateway authorization:
 * group-inherited scopes are not usable for SQL writes until LOC Auth explicitly
 * issues equivalent resource grants. No privilege is inferred from role strings.
 */
export function locRolePrincipal(claims,{scopeTree=[]}={}){
  if(claims?.provider!=='loc'||claims?.me!==true||
     !SUBJECT.test(String(claims?.sub||'')))return null;
  const grants=Array.isArray(claims.grants)?claims.grants:[];
  const {nodes,children}=trustedScopeTree(scopeTree);
  const scopeIds=new Set(),groupIds=new Set();
  const global=grants.includes('global:manage');
  for(const value of grants){
    if(typeof value!=='string')continue;
    const match=MANAGE.exec(value);
    if(!match)continue;
    const id=match[1],node=nodes.get(id);
    if(node&&!node.active)continue;
    if(node?.kind==='group'){
      // Walk downward only; managers never inherit their parent Group's rights.
      const visited=new Set(),pending=[id];
      for(let n=0;n<pending.length;n++){
        const current=pending[n];
        if(visited.has(current))
          throw new Error('Cyclic LOC virtual Group hierarchy');
        visited.add(current);
        const item=nodes.get(current);
        if(!item?.active)continue;
        if(item.kind==='group'){
          groupIds.add(current);
          for(const child of children.get(current)||[])pending.push(child);
        }else if(item.kind==='scope')scopeIds.add(current);
      }
    }else if(node?.kind==='scope'||!node){
      // Unknown IDs retain only their EXPLICIT Scope grant; no Group inference.
      scopeIds.add(id);
    }
  }
  const role=global?'admin':groupIds.size?'group':scopeIds.size?'scope':'user';
  return Object.freeze({
    id:String(claims.sub),role,roleLevel:LOC_ROLE_LEVEL[role],
    scopeIds:Object.freeze([...scopeIds].sort()),
    groupIds:Object.freeze([...groupIds].sort())
  });
}
