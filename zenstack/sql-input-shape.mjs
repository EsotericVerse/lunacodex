// Shared server-side Zod input shapes for the existing Kysely operations.
// ZenStack's SchemaDef supplies physical fields separately via model-column-guard.
// This module never opens a connection, queries a provider, or grants access.
import * as z from 'zod';

const IDENT=/^[a-z][a-z0-9_]*$/i;
const name=z.string().regex(IDENT);
const QUERY_OPERATIONS=['select','insert','update','delete','upsert'];

export const QUERY_FILTER_SQL=Object.freeze({
  eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',ieq:'=',contains:'contains',is:'is',in:'in'
});
export const MANAGED_FILTER_SQL=Object.freeze({
  eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',is:'is',in:'in'
});

// Public Pages SELECTs use a smaller transport shape than signed LOC
// mutations, but share this exact Zod syntax layer and operator vocabulary.
// The route still owns relation allowlists, source visibility, pagination
// semantics, SQL predicates and ZModel column authorization.
const publicName=z.string().regex(/^[a-z_][a-z0-9_]*$/i);
const publicFilter=z.looseObject({
  column:publicName,op:z.enum(Object.keys(QUERY_FILTER_SQL))
});
const publicOrder=z.looseObject({column:publicName});
const publicProjection=z.array(z.union([publicName,z.literal('*')]))
  .min(1).max(48).refine(columns=>columns.length===1||!columns.includes('*'));
const publicSelect=z.strictObject({
  schema:z.string(),table:z.string(),columns:publicProjection,
  filters:z.array(publicFilter).max(30).nullish(),
  orFilters:z.array(z.string().max(4000)).max(10).nullish(),
  orders:z.array(publicOrder).max(10).nullish(),
  // The existing transport accepts decimal numeric strings. Its strict
  // safe-integer checks remain at the route boundary; no Zod coercion.
  limit:z.unknown().optional(),offset:z.unknown().optional(),
  head:z.boolean().nullish(),count:z.literal('exact').nullish(),
  cardinality:z.enum(['single','maybeSingle']).nullish()
});
export function assertPublicKyselyReadShape(input){
  const checked=publicSelect.safeParse(input);
  if(checked.success)return input;
  const first=checked.error.issues[0];
  if(first?.code==='unrecognized_keys')
    throw new Error('Unexpected SQL query field');
  const key=String(first?.path?.[0]||'');
  const reason={
    columns:'Invalid public SQL projection',filters:'Invalid filter',
    orFilters:'Invalid grouped query',orders:'Invalid order',
    limit:'Invalid SQL page bounds',offset:'Invalid SQL page bounds',
    head:'Invalid SQL HEAD',count:'Invalid SQL count mode',
    cardinality:'Invalid SQL result cardinality'
  }[key]||'Invalid LOC public query';
  throw new Error(reason);
}

const queryFilter=z.looseObject({
  column:name,operator:z.enum(Object.keys(QUERY_FILTER_SQL)),
  value:z.unknown().optional()
});
const orderedColumn=z.looseObject({column:name});
const query=z.looseObject({
  kind:z.literal('query'),schema:name,table:name,
  operation:z.enum(QUERY_OPERATIONS),
  filters:z.array(queryFilter).optional(),
  columns:z.array(z.union([name,z.literal('*')])).optional(),
  orders:z.array(orderedColumn).optional(),
  or:z.array(z.string()).max(10).optional(),
  single:z.enum(['single','maybeSingle']).optional()
});

// Preserve the existing business errors and untouched request values. Zod
// validates only the syntax of the request; it does not coerce SQL values.
export function assertKyselyQueryShape(input){
  if(input?.kind!=='query')throw new Error('Invalid request kind');
  const checked=query.safeParse(input);
  if(checked.success)return input;
  const first=String(checked.error.issues[0]?.path?.[0]||'');
  const reason={
    schema:'Invalid schema',table:'Invalid table',
    operation:'Unsupported operation',filters:'Invalid filter',
    columns:'Invalid selected column',orders:'Invalid order column',
    or:'Invalid OR filter',single:'Invalid row cardinality'
  }[first]||'Invalid LOC SQL request';
  throw new Error(reason);
}

const managedRow=z.record(name,z.unknown())
  .refine(value=>Object.keys(value).length>0);
const managedFilter=z.looseObject({
  column:name,operator:z.enum(Object.keys(MANAGED_FILTER_SQL)).optional(),
  value:z.unknown().optional()
}).refine(value=>value.operator!=='in'||
  (Array.isArray(value.value)&&value.value.length<=500));
const managedFilters=z.array(managedFilter).min(1).max(20);
const managedRowCount=z.array(z.unknown()).min(1).max(10000);

export function managedRowsIssue(rows){
  if(!managedRowCount.safeParse(rows).success)return 'batch';
  return rows.some(row=>!managedRow.safeParse(row).success)?'row':'';
}
export function managedUpdateValuesValid(value){
  return managedRow.safeParse(value).success&&
    !Object.hasOwn(value,'uid')&&!Object.hasOwn(value,'id');
}
export function managedFiltersValid(value){
  return managedFilters.safeParse(value).success;
}
