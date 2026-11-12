import {schema} from './schema.mjs';
import {locRolePrincipal} from './role-hierarchy.mjs';

const PUBLIC_FIXED_MODELS=Object.freeze({
  'api.manage':'Manage',
  'silver.loc':'Loc',
  'silver.lo3rwang':'Lo3rwang',
  'silver.lrunes':'Lrunes',
  'silver.loc_blocks':'LocBlocks',
  'silver.lo3rwang_blocks':'Lo3rwangBlocks',
  'silver.lrunes_blocks':'LrunesBlocks'
});
const ADMIN_FIXED_WRITES=Object.freeze({
  'api.manage':'Manage',
  'silver.loc':'Loc'
});
/** Only signed global LOC grants may update/delete a fixed admin model. */
export function fixedPolicyWriteModel(target,body,role,claims){
  if(target?.engine!=='postgres'||
      role!=='authenticated'||claims?.provider!=='loc'||claims?.me!==true||
      !Array.isArray(claims.grants)||!claims.grants.includes('global:manage'))
    return null;
  let relation='';
  if(body?.kind==='managed-write'&&['update','delete'].includes(body.payload?.p_operation))
    relation=String(body.payload?.p_table||'');
  else if(body?.kind==='query'&&['update','delete'].includes(body.operation))
    relation=String(body.schema||'')+'.'+String(body.table||'');
  return ADMIN_FIXED_WRITES[relation]||null;
}

const readers=new WeakMap();

/** Only the designated publicly readable fixed LOC control and presentation
 * relations.
 * The same fixed policy applies to independent PostgreSQL Kysely connections.
 * Dynamic Galaxy, Anchor and other models continue through the existing
 * signed Kysely transaction boundary; non-PostgreSQL dialects use LOC ACL.
 */
export function fixedPolicyReadModel(target,body){
  if(target?.engine!=='postgres'||
     body?.kind!=='query'||body.operation!=='select')return null;
  return PUBLIC_FIXED_MODELS[String(body.schema||'')+'.'+String(body.table||'')]||null;
}

/** Construct exactly one ZenStack+PolicyPlugin reader per existing Kysely
 * instance. It shares the same trusted dialect/pool, not another SQL
 * connection target. No permission table SELECT is performed.
 *
 * Raw SQL is permitted only for trusted internal SET LOCAL role/JWT session
 * statements. The public request transport does not expose a raw SQL action.
 */
export function fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin}={}){
  if(!db||!dialect||typeof ZenStackClient!=='function'||typeof PolicyPlugin!=='function')
    throw new TypeError('Trusted ZenStack policy runtime is required');
  let reader=readers.get(db);
  if(reader)return reader;
  const client=new ZenStackClient(schema,{dialect});
  reader=client.$use(new PolicyPlugin({dangerouslyAllowRawSql:true}));
  readers.set(db,reader);
  return reader;
}

/** Execute a trusted fixed-model SELECT using the existing Kysely transaction.
 * ZenStack 3.10.1 also rewrites mapped $qb statements with model policy
 * predicates (verified separately), but raw and unmapped SQL are not
 * assumed policy-enforced. Gateway authorization remains mandatory.
 */
export async function withFixedPolicyRead(db,target,body,role,claims,
  {dialect,ZenStackClient,PolicyPlugin},run){
  const modelName=fixedPolicyReadModel(target,body);
  if(!modelName)throw new Error('Not a fixed public ZModel policy query');
  const reader=fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin});
  const auth=role==='authenticated'&&claims?.provider==='loc'&&claims?.me===true
    ?locRolePrincipal(claims)
    :undefined;
  return reader.$setAuth(auth).$transaction(async scoped=>{
    if(!scoped?.$qb)throw new Error('Policy-enforced Kysely transaction missing');
    return run(scoped.$qb,modelName,scoped);
  });
}

/** Trusted global registry write. The Gateway verifies the signed LOC
 * delegation, and managed-write retains its original canManageLoc guard.
 * Mapped $qb receives tested model predicates in ZenStack 3.10.1,
 * while Gateway authorization guards every privileged write separately.
 * A grant-derived admin principal is bound once per transaction; no SQL
 * permission lookup or second driver/pool is created by this adapter.
 */
export async function withFixedPolicyWrite(db,target,body,role,claims,
  {dialect,ZenStackClient,PolicyPlugin},run){
  const modelName=fixedPolicyWriteModel(target,body,role,claims);
  if(!modelName)throw Object.assign(
    new Error('Global LOC policy permission required'),{httpStatus:403});
  const reader=fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin});
  return reader.$setAuth(locRolePrincipal(claims))
    .$transaction(async scoped=>{
      if(!scoped?.$qb)throw new Error('Policy-enforced Kysely transaction missing');
      return run(scoped.$qb,modelName);
    });
}
