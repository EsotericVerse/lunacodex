'use client';

import {createDatabaseClient} from './db-contract.mjs';
import {createConfiguredAdapter} from './providers/configured.mjs';
import {configureDbSourceLabels} from './db-source-status.mjs';
import {unifiedAnchorSpec,unifiedAnchorRelation} from './unified-anchor-compat.mjs';

// Provider construction is the only runtime composition point.
// The static site reads public records from the owner's existing Data API.
const adapter=createConfiguredAdapter();
configureDbSourceLabels(adapter.primarySourceLabel||'Primary',adapter.backupSourceLabel??'');

// The Local Scope has not been provisioned. Do not send device-private
// queries to the configured remote SQL database.
function isUnprovisionedLocal(table,schemaName){
  if(schemaName==='local')return true;
  const name=String(table||'').split('.').pop();
  return name==='local'||name.startsWith('local_');
}
function unavailableLocal(){
  throw new Error('Local Scope 尚未設定資料庫引擎，本機資料庫功能未啟用。');
}
function routedSchema(schemaName,cloudSchema){
  return {
    from(table){
      if(isUnprovisionedLocal(table,schemaName))return unavailableLocal();
      const unified=unifiedAnchorSpec(schemaName,table);
      return unified?unifiedAnchorRelation(cloudSchema,unified):cloudSchema.from(table);
    },
    managedWrite(payload){
      if(isUnprovisionedLocal(payload?.p_table,schemaName))return unavailableLocal();
      return cloudSchema.managedWrite(payload);
    },
    managedAction(name,args={}){
      if(schemaName==='local'||args?.p_scope_id==='local')return unavailableLocal();
      return cloudSchema.managedAction(name,args);
    },
    anchor(scopeId,type,attr={}){
      if(scopeId==='local')return unavailableLocal();
      return cloudSchema.anchor(scopeId,type,attr);
    },
    analytics(args){
      if(String(args?.p_scope_id||'')==='local')return unavailableLocal();
      const source=cloudSchema.analytics?cloudSchema:
        (adapter.configuredPublicClient||adapter.publicClient).schema(schemaName);
      return source.analytics(args);
    },
    publicAction(name,args={}){
      if(schemaName==='local'||args?.p_scope_id==='local')return unavailableLocal();
      const source=cloudSchema.publicAction?cloudSchema:
        (adapter.configuredPublicClient||adapter.publicClient).schema(schemaName);
      return source.publicAction(name,args);
    }
  };
}

const routedAdapter={
  ...adapter,
  publicClient:{schema:name=>routedSchema(name,adapter.publicClient.schema(name))},
  authClient:{schema:name=>routedSchema(name,adapter.authClient.schema(name)),
    shortImport:(scopeid,batch)=>adapter.authClient.shortImport(scopeid,batch)}
};
const client=createDatabaseClient(routedAdapter);

// Online tabletop uses a dedicated LOC room Worker; database routing owns no sockets.
export const dbBackupPublicClient=adapter.backupPublicClient||null;
export const dbConfiguredPublicClient=adapter.configuredPublicClient
  ?{schema:name=>routedSchema(name,adapter.configuredPublicClient.schema(name))}:null;
// Passive Auth events use the configured SDK, not the routed query client.
export const dbAuthEvents=adapter.auth;
export const dbPrimarySourceLabel=adapter.primarySourceLabel||'Primary';
export const dbBackupSourceLabel=adapter.backupSourceLabel??'';
export const {publicClient:dbPublicClient,authClient:dbAuthClient,dbAuthRelation,selectAuthRow,insertRows,insertImportRows,updateRows,deleteRows,updateImportRows,resetKeywordClassification,readKeywordClass,readScopeStatistics,readScopeCategoryTotals,readScopeOverview,readScopeEarliest,readLocStatistics,findGalaxyDuplicates,readKeywordTreeSummary,readKeywordTreeCatalog,readSharedKeywordClasses,writeKeywordLibraryItem,copyKeywordLibraryClass,copyRune66KeywordClass,deleteScope,moveScopeBlock,provisionScope,manageScopeRegistry,getAccountSession,signInWithGoogle,signOutAccount}=client;
