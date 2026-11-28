'use server';

import {withPublicLocRead} from '../read-context.mjs';
import {accessibleKeywordLucus} from '../../keywords/lucus-search.mjs';
import {mapBounded} from '../../query/bounded-parallel.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {PUBLIC_GALAXY_PRIVATE_SITES} from '../../model/galaxy-feature-queries.mjs';
import {galaxyReadColumns} from '../../../../packages/zenstack/galaxy-read-models.mjs';
import {assertZModelLucusFeatureRows}
  from '../../../../packages/zenstack/import-validation.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';
import {scopeTableName} from '../../../../packages/zenstack/scope-table-names.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const publicScopes=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&row.scope_id!=='loc'&&row.scope_id!=='admin').map(row=>row.scope_id));
const chunks=(values,size)=>{
  const result=[];
  for(let index=0;index<values.length;index+=size)result.push(values.slice(index,index+size));
  return result;
};

async function readScopePatterns(db,port,scopeId){
  const namespace=port.namespace||(port.engine==='postgres'?'silver':'dbo');
  const visibility=await accessibleKeywordLucus(db,scopeId,false,{engine:port.engine,namespace});
  if(!visibility.published||!visibility.patterns.size)return {patterns:[],featuredArticles:[]};
  const lucus=portableRelation(scopeTableName(scopeId,'lucus'),port.engine,namespace),patterns=[];
  for(const ids of chunks([...visibility.patterns],512)){
    const rows=await db.selectFrom(lucus).select(['uid','type','title','description'])
      .where('type','=','pattern').where('invisible','=',false).where('uid','in',ids)
      .orderBy('uid','asc').execute();
    assertZModelLucusFeatureRows(rows);
    patterns.push(...rows.filter(row=>UID.test(String(row.uid||''))&&String(row.title||'').trim()).map(row=>({
      scopeId,uid:String(row.uid),title:String(row.title).trim(),
      requestedFeaturedUid:UID.test(String(row.description||'').trim())?String(row.description).trim():''
    })));
  }
  const requested=new Set(patterns.map(row=>row.requestedFeaturedUid).filter(Boolean)),featuredArticles=[];
  const galaxy=portableRelation(scopeTableName(scopeId,'galaxy'),port.engine,namespace);
  for(const ids of chunks([...requested],100)){
    const rows=await db.selectFrom(galaxy).select(galaxyReadColumns('GalaxyList'))
      .where('uid','in',ids).where('list','=',true).where('search','=',true).where('extract','=',true)
      .where(eb=>eb.or([eb('site','is',null),eb(eb.fn('lower',['site']),'not in',PUBLIC_GALAXY_PRIVATE_SITES)]))
      .execute();
    featuredArticles.push(...rows.map(row=>({...row,scope_id:scopeId})));
  }
  const publicTargets=new Set(featuredArticles.map(row=>String(row.uid)));
  return {patterns:patterns.map(({requestedFeaturedUid,...row})=>({
    ...row,featuredUid:publicTargets.has(requestedFeaturedUid)?requestedFeaturedUid:''
  })),featuredArticles};
}

export async function queryPublicSearchPatternIndex(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>key!=='scopeIds'))
    throw Error('Invalid public Search Pattern request');
  const requested=args.scopeIds;
  if(!Array.isArray(requested)||requested.length>100||requested.some(scope=>typeof scope!=='string'||!publicScopes.has(scope)))
    throw Error('Invalid public Search Scope list');
  const scopeIds=[...new Set(requested)];
  if(!scopeIds.length)return {patterns:[],featuredArticles:[]};
  return withPublicLocRead({scopes:scopeIds},async(db,port)=>{
    const results=await mapBounded(scopeIds,2,scopeId=>readScopePatterns(db,port,scopeId));
    return {patterns:results.flatMap(result=>result.patterns),featuredArticles:results.flatMap(result=>result.featuredArticles)};
  });
}
