'use client';

import {createDatabaseClient} from './db-contract.mjs';
import {createConfiguredAdapter} from './providers/configured.mjs';
import {configureDbSourceLabels} from './db-source-status.mjs';
import {createLocalSqliteAdapter} from './providers/local-sqlite.mjs';
import {unifiedAnchorSpec,unifiedAnchorRelation} from './unified-anchor-compat.mjs';

// Provider construction is the only runtime composition point.
const adapter=createConfiguredAdapter();
configureDbSourceLabels(adapter.primarySourceLabel||'Primary',adapter.backupSourceLabel??'');

// The device-local SQLite backend for the hidden `local` Scope (see
// providers/local-sqlite.mjs) is spliced in at this single composition
// point: a `local`/`local_*`/`runes*` table or a `local`-scoped RPC call is
// routed to it; everything else keeps going to the normal Supabase/Neon
// adapter exactly as before. No other file (db-query.mjs, galaxy-query.js,
// db-contract.mjs, or any feature page) needs to know a second backend
// exists or branch on scope id -- they keep calling dbPublicClient /
// dbAuthClient / insertRows / readScopeStatistics / etc. exactly as today.
const localAdapter=createLocalSqliteAdapter();
// `runes`/`runes_etc`/`runes_group` is a BARE table name collision: the
// on-device "local" Scope plans its own read-only copy of these under that
// same name (see local-sqlite.mjs's header comment), but the live,
// pre-existing `silver.runes*` tables -- read by the whole Rune feature
// (draw, directory, 3D library, daily log, game board, management panel)
// site-wide, today -- share the exact same bare name. Matching on name
// alone silently redirected every one of those production reads to the
// empty on-device SQLite file (confirmed: silver.runes_group/runes/runes_etc
// instead of Supabase), breaking every rune draw.
// `local`/`local_*` has no such collision (nothing else in the app uses
// those names), so only the runes* tables need the schema check: they only
// ever route locally under the Scope's own `local` schema, never `silver`.
function isLocalRelation(table,schemaName){
  const name=String(table||'').split('.').pop();
  if(name==='local'||name.startsWith('local_'))return true;
  if(name==='runes'||name==='runes_etc'||name==='runes_group')return schemaName==='local';
  return false;
}
function routedSchema(schemaName,cloudSchema){
  const localSchema=localAdapter.publicClient.schema(schemaName);
  return {
    from(table){
      if(isLocalRelation(table,schemaName))return localSchema.from(table);
      const unified=unifiedAnchorSpec(schemaName,table);
      return unified?unifiedAnchorRelation(cloudSchema,unified):cloudSchema.from(table);
    },
    rpc(name,args={},options={}){
      const toLocal=name==='management_write'?isLocalRelation(args?.p_table,schemaName):String(args?.p_scope_id||'')==='local';
      return toLocal?localSchema.rpc(name,args):cloudSchema.rpc(name,args,options);
    }
  };
}
// Only `.schema(...)` is ever called on dbPublicClient/dbAuthClient anywhere
// in the app (verified: db-query.mjs's publicRelation, db-contract.mjs's
// dbAuthRelation); `auth` is taken from `adapter.auth` directly, not off
// these clients, so the routed objects only need to carry `.schema`.
const routedAdapter={
  ...adapter,
  publicClient:{schema:name=>routedSchema(name,adapter.publicClient.schema(name))},
  authClient:{schema:name=>routedSchema(name,adapter.authClient.schema(name))}
};
const client=createDatabaseClient(routedAdapter);

// Use the existing public Supabase SDK socket for browser/iOS game rooms.
export const dbRealtimeClient=adapter.realtimeClient;
// Canonical typed Anchor gateway. Scope resolution and authorization live in SQL,
// not in client-side branches for lo3rwang/lrunes.
export async function scopeTypeAttr(scopeId,type,attr={}, {write=false}={}){
  const id=String(scopeId||'').trim().toLowerCase();
  const kind=String(type||'').trim();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(id))throw new Error('Invalid Anchor Scope');
  if(!['date','period','era','point','path','trace','image','video','rune','suno','category','class','group','item'].includes(kind))
    throw new Error('Invalid Anchor type');
  if(!attr||typeof attr!=='object'||Array.isArray(attr))throw new Error('Anchor attr must be a JSON object');
  const op=String(attr.op||'read');
  if(write!==['insert','update','patch','delete'].includes(op))
    throw new Error('Anchor write option does not match operation');
  const client=write?adapter.authClient:adapter.publicClient;
  const {data,error}=await client.schema('silver').rpc('scope_type_attr',{
    p_scope_id:id,p_type:kind,p_attr:attr
  });
  if(error)throw new Error(error.message||'Anchor request failed');
  return data;
}

export const dbBackupPublicClient=adapter.backupPublicClient||null;
export const dbConfiguredPublicClient=adapter.configuredPublicClient
  ?{schema:name=>routedSchema(name,adapter.configuredPublicClient.schema(name))}:null;
// Passive Auth events use the configured SDK, not the routed query client.
export const dbAuthEvents=adapter.auth;
export const dbPrimarySourceLabel=adapter.primarySourceLabel||'Primary';
export const dbBackupSourceLabel=adapter.backupSourceLabel??'';
export const {publicClient:dbPublicClient,authClient:dbAuthClient,dbAuthRelation,selectAuthRow,insertRows,insertImportRows,updateRows,deleteRows,updateImportRows,resetKeywordClassification,readKeywordClass,readScopeStatistics,readScopeCategoryTotals,readScopeOverview,readScopeEarliest,readLocStatistics,findGalaxyDuplicates,readKeywordTreeSummary,readKeywordTreeCatalog,readSharedKeywordClasses,writeKeywordLibraryItem,copyKeywordLibraryClass,copyRune66KeywordClass,isCurrentEmailBlocklisted,deleteScope,moveScopeBlock,provisionScope,manageScopeRegistry,getAccountSession,signInWithGoogle,signOutAccount}=client;
