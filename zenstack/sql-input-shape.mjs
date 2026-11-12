// Shared server-side Zod input shapes for the existing Kysely operations.
// ZenStack's SchemaDef supplies physical fields separately via model-column-guard.
// This module never opens a connection, queries a provider, or grants access.
import * as z from 'zod';

const IDENT=/^[a-z][a-z0-9_]*$/i;
const name=z.string().regex(IDENT);
const QUERY_OPERATIONS=['select','insert','update','delete','upsert'];

export const QUERY_FILTER_SQL=Object.freeze({
  eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',contains:'contains',is:'is',in:'in'
});
export const MANAGED_FILTER_SQL=Object.freeze({
  eq:'=',neq:'!=',gt:'>',gte:'>=',lt:'<',lte:'<=',
  like:'like',ilike:'ilike',is:'is',in:'in'
});

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
