'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {keywordPatternStatistics,suggestSearchPatterns}
  from '../../providers/kysely-management.mjs';

const validScope=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw Error('Invalid Keyword Scope');
  return scope;
};

export async function queryKeywordPatternStatistics(args={}){
  const scope=validScope(args.p_scope_id);
  if(Object.keys(args).some(key=>!['p_scope_id','p_class_uid','p_start_date',
    'p_end_date','p_source'].includes(key)))throw Error('Invalid Keyword statistics request');
  return withAuthorizedLocRead({scope},async db=>({
    data:await keywordPatternStatistics(db,args),count:null
  }));
}

export async function querySearchPatternSuggestions(args={}){
  const scopes=Array.isArray(args.p_scope_ids)?[...new Set(args.p_scope_ids.map(validScope))]:[];
  if(scopes.length<1||scopes.length>50||
    Object.keys(args).some(key=>!['p_scope_ids','p_query'].includes(key)))
    throw Error('Invalid search-pattern request');
  return withAuthorizedLocRead({scopes},async db=>({
    data:await suggestSearchPatterns(db,{p_scope_ids:scopes,p_query:args.p_query}),count:null
  }));
}
