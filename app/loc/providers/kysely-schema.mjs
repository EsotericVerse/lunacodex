import {sql} from 'npm:kysely@0.29.8';
import {portableRelation} from './sql-engine-ports.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const FLAGS=['statics','culture','search','trace','list','keyword','extract','others'];

/**
 * The only required per-Scope SQL relations. No stored procedures, DB auth
 * accounts, triggers, or LOC control tables are created in the user's DB.
 * The existing tables are never modified by this installer.
 */
export async function ensurePortableScopeSchema(db,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope or SQL engine');
  const scope=scopeId;
  const meta=await db.introspection.getTables();
  const existing=new Set(meta.filter(row=>!row.schema||row.schema===namespace)
    .map(row=>row.name));
  const textType=engine==='mssql'?sql.raw('nvarchar(max)'):'text';
  const jsonType=engine==='postgres'?'jsonb':engine==='mysql'?'json':sql.raw('nvarchar(max)');
  const dateTimeType=engine==='postgres'?'timestamptz':
    engine==='mssql'?'datetime2':'datetime';
  const boolType=engine==='mssql'?'bit':'boolean';
  const uidType=engine==='mssql'
    ?sql.raw('varchar(8) COLLATE Latin1_General_100_BIN2'):'varchar(8)';
  const created=[];
  const createTable=name=>{
    let builder=db.schema.createTable(portableRelation(name,engine,namespace));
    if(engine!=='mssql')builder=builder.ifNotExists();
    return builder;
  };
  const finalize=async(builder,name,indexColumn)=>{
    if(engine==='mysql')builder=builder.modifyEnd(
      sql.raw('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'));
    await builder.execute();
    await db.schema.createIndex(scope+'_'+indexColumn+'_idx')
      .on(portableRelation(name,engine,namespace)).column(indexColumn).execute();
    created.push(name);
  };
  if(!existing.has(scope+'_galaxy')){
    let q=createTable(scope+'_galaxy')
      .addColumn('uid',uidType,c=>c.primaryKey().notNull())
      .addColumn('title',textType)
      .addColumn('content',textType)
      .addColumn('createtime',dateTimeType)
      .addColumn('location',textType)
      .addColumn('UpdateTime',dateTimeType,c=>c.notNull().defaultTo(sql.raw('CURRENT_TIMESTAMP')))
      .addColumn('url',textType)
      .addColumn('source_id',uidType)
      .addColumn('target_id',jsonType)
      .addColumn('ref_id',uidType)
      .addColumn('site',textType)
      .addColumn('place_id',uidType)
      .addColumn('media_link',jsonType)
      .addColumn('date','date')
      .addColumn('site_id',textType);
    for(const flag of FLAGS)
      q=q.addColumn(flag,boolType,c=>c.notNull().defaultTo(true));
    await finalize(q,scope+'_galaxy','date');
  }
  if(!existing.has(scope+'_anchor')){
    let q=createTable(scope+'_anchor')
      .addColumn('uid',uidType,c=>c.primaryKey().notNull())
      .addColumn('type','varchar(16)',c=>c.notNull())
      .addColumn('title',textType)
      .addColumn('description',textType)
      .addColumn('invisible',boolType,c=>c.notNull().defaultTo(false))
      .addColumn('attr',jsonType,c=>c.notNull());
    await finalize(q,scope+'_anchor','type');
  }
  return {created};
}
