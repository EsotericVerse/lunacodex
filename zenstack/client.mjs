// Server-side fixed-model ZenStack V3 client factory.
// The dialect is injected from the trusted Kysely server connection layer;
// never construct a database connection, migrate a schema, or fetch secrets here.
// Verify native LOC OAuth delegations and Scope grants at the trusted Gateway BEFORE use.
// Dynamic per-Scope tables and non-Postgres dialects use native Kysely directly.
import {ZenStackClient} from '@zenstackhq/orm';
import {defineCachePlugin} from '@visualbravo/zenstack-cache';
import {MemoryCacheProvider} from '@visualbravo/zenstack-cache/providers/memory';
import {schema} from './schema.mjs';
import {scopedZModelSchema} from './scoped-schema.mjs';

// One memory provider per server isolate, shared by existing ZModel clients.
// It does not contact Auth, SQL, Redis, or schedule revalidation.
// Cache is opt-in per supported query; never cache privileged identity/grants.
const provider=new MemoryCacheProvider();
const withModelCache=client=>client.$use(defineCachePlugin({provider}));


export function createFixedLocClient({dialect}={}){
  if(!dialect||typeof dialect.createDriver!=='function'||
    typeof dialect.createAdapter!=='function'||
    typeof dialect.createQueryCompiler!=='function'||
    typeof dialect.createIntrospector!=='function')
    throw new TypeError('A trusted Kysely dialect is required');
  return withModelCache(new ZenStackClient(schema,{dialect}));
}

// Server-only native ZenStack ORM for one independently stored Scope.
// This factory does NOT verify LOC Auth, apply business visibility rules, or
// install a PolicyPlugin with a made-up blanket access rule. Call it only
// inside the already-authorized LOC application-server execution boundary. Existing
// dynamic Kysely SQL remains available for unsupported operations/dialects.
export function createScopedLocClient({dialect,scopeId,namespace='silver'}={}){
  if(!dialect||typeof dialect.createDriver!=='function'||
    typeof dialect.createAdapter!=='function'||
    typeof dialect.createQueryCompiler!=='function'||
    typeof dialect.createIntrospector!=='function')
    throw new TypeError('A trusted Kysely dialect is required');
  return withModelCache(new ZenStackClient(scopedZModelSchema({scopeId,namespace}),{dialect}));
}
