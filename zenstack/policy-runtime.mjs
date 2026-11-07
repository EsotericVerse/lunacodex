import {schema} from './schema.mjs';

const PUBLIC_FIXED_MODELS=Object.freeze({
  'api.manage':'Manage',
  'silver.loc':'Loc',
  'silver.lo3rwang':'Lo3rwang',
  'silver.lrunes':'Lrunes'
});
const ADMIN_FIXED_WRITES=Object.freeze({
  'api.manage':'Manage',
  'silver.loc':'Loc'
});
/** Only signed global LOC grants may update/delete a fixed admin model. */
export function fixedPolicyWriteModel(target,body,role,claims){
  if(target?.engine!=='postgres'||target.provider!=='supabase'||
      role!=='authenticated'||claims?.provider!=='loc'||claims?.me!==true||
      !Array.isArray(claims.grants)||!claims.grants.includes('global:manage')||
      body?.kind!=='managed-write'||!['update','delete'].includes(body.payload?.p_operation))
    return null;
  return ADMIN_FIXED_WRITES[String(body.payload?.p_table||'')]||null;
}

const readers=new WeakMap();

/** Only the four designated publicly readable fixed LOC control relations.
 * Dynamic Galaxy, Anchor and other protected models continue through the
 * existing signed Kysely transaction boundary, never an unsecured fallback.
 */
export function fixedPolicyReadModel(target,body){
  if(target?.engine!=='postgres'||target?.provider==='custom'||
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

/** Execute the public fixed-model SELECT in the policy-enforced transaction.
 * The callback receives that transaction's Kysely builder and verified model.
 * The policy plugin adds the allow/read predicate to the SAME SQL query.
 */
export async function withFixedPolicyRead(db,target,body,role,claims,
  {dialect,ZenStackClient,PolicyPlugin},run){
  const modelName=fixedPolicyReadModel(target,body);
  if(!modelName)throw new Error('Not a fixed public ZModel policy query');
  const reader=fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin});
  const auth=role==='authenticated'&&claims?.provider==='loc'&&claims?.me===true
    ?{id:String(claims.sub||''),role:'authenticated'}
    :undefined;
  return reader.$setAuth(auth).$transaction(async scoped=>{
    if(!scoped?.$qb)throw new Error('Policy-enforced Kysely transaction missing');
    return run(scoped.$qb,modelName);
  });
}

/** Policy-enforced global registry write. The gateway has verified the
 * delegation, and managed-write retains its original canManageLoc guard.
 * A grant-derived admin principal is bound once per transaction; no SQL
 * permission lookup or second driver/pool is created by this adapter.
 */
export async function withFixedPolicyWrite(db,target,body,role,claims,
  {dialect,ZenStackClient,PolicyPlugin},run){
  const modelName=fixedPolicyWriteModel(target,body,role,claims);
  if(!modelName)throw Object.assign(
    new Error('Global LOC policy permission required'),{httpStatus:403});
  const reader=fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin});
  return reader.$setAuth({id:String(claims.sub||''),role:'admin'})
    .$transaction(async scoped=>{
      if(!scoped?.$qb)throw new Error('Policy-enforced Kysely transaction missing');
      return run(scoped.$qb,modelName);
    });
}
