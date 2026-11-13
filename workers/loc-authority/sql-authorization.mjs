// Engine-neutral LOC Authority query classification. No SQL dialect, Auth SDK,
// database client, or RLS dependency. A trusted Gateway must verify the JWT
// before using this policy and enforce its decision BEFORE executing SQL.
const scopeId=/^[a-z][a-z0-9]{0,14}$/;
const tableId=/^[a-z][a-z0-9_]{0,62}$/;
const allowedActions=new Set(['select','insert','update','delete','upsert']);
const publicReferences=new Set(['runes','runes_etc','runes_group']);
export function classifyPortableSqlRequest(request){
  if(!request||request.kind!=='query'||request.schema!=='silver'||
    !tableId.test(String(request.table||''))||!allowedActions.has(request.operation))
    throw Object.assign(new Error('Unsupported portable SQL request'),{httpStatus:403});
  // LOC text frames now live only in silver.loc_anchor; fail closed on
  // the old literal rather than letting the generic _blocks regex admit it.
  if(request.table==='loc_blocks')
    throw Object.assign(new Error('Retired LOC Blocks relation'),{httpStatus:403});
  if(publicReferences.has(request.table)&&request.operation==='select')
    return Object.freeze({public:true,scope:null,action:'read',resource:'silver.'+request.table});
  // Only one self-contained scope table family is grant-addressable;
  // non-Scope global tables require a different, explicit policy.
  const match=request.table.match(/^([a-z][a-z0-9]{0,14})(?:_(galaxy|galaxy_media|keywords|blocks|trace|road|period|settings))?$/);
  if(!match||!scopeId.test(match[1])||['manage','runes'].includes(match[1]))
    throw Object.assign(new Error('Unmapped resource requires explicit Authority policy'),{httpStatus:403});
  return Object.freeze({
    public:false,scope:match[1],resource:'silver.'+request.table,
    action:request.operation==='select'?'read':'write'
  });
}
export async function assertPortableSqlAuthority(request,{identity,mayAccess}={}){
  const rule=classifyPortableSqlRequest(request);
  if(rule.public)return rule;
  if(!identity||!identity.provider||!identity.subject||typeof mayAccess!=='function')
    throw Object.assign(new Error('Verified identity and independent Authority required'),{httpStatus:401});
  const allowed=await mayAccess({
    provider:identity.provider,subject:identity.subject,scope:rule.scope,action:rule.action
  });
  if(!allowed)throw Object.assign(new Error('Scope operation is not permitted'),{httpStatus:403});
  return rule;
}
