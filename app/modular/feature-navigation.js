import {z} from 'zod';
import {featureHref} from './scope-registry';
import {normalizeRelationIds} from '../loc/content-policy';

const NAVIGATION_FIELDS=Object.freeze([
  'q','place','map','identity','media','source','period','anchor','from','to','rankingType','statTab'
]);

const NavigationValue=z.string().trim().min(1).max(240);
const StatisticsTab=z.enum(['ranking','keywords','styles','media','charts']);

const FeatureNavigationSchema=z.object({
  q:NavigationValue.optional(),
  place:NavigationValue.optional(),
  map:NavigationValue.optional(),
  identity:NavigationValue.optional(),
  media:NavigationValue.optional(),
  source:NavigationValue.optional(),
  period:NavigationValue.optional(),
  anchor:NavigationValue.optional(),
  from:NavigationValue.optional(),
  to:NavigationValue.optional(),
  rankingType:NavigationValue.optional(),
  statTab:StatisticsTab.optional()
}).strict();

function valueOf(...values){
  for(const value of values){
    if(value===undefined||value===null)continue;
    const text=String(value).trim();
    if(text)return text.slice(0,240);
  }
  return undefined;
}


export function readFeatureNavigation(searchParams){
  const raw={};
  for(const key of NAVIGATION_FIELDS){
    const value=searchParams?.get?.(key);
    if(value)raw[key]=value;
  }
  const parsed=FeatureNavigationSchema.safeParse(raw);
  return parsed.success?parsed.data:{};
}

function featureNavigationQuery(navigation={}){
  const params=new URLSearchParams();
  const parsed=FeatureNavigationSchema.safeParse(navigation);
  if(!parsed.success)return '';
  for(const key of NAVIGATION_FIELDS){
    const value=parsed.data[key];
    if(value)params.set(key,value);
  }
  return params.toString();
}

export function featureNavigationHref(scopeId,featureId,navigation={}){
  const base=featureHref(scopeId,featureId);
  const query=featureNavigationQuery(navigation);
  return query?base+'?'+query:base;
}


export function galaxyIdentityHref(scopeId,uid){
  const id=valueOf(uid);
  if(!id)return '';
  const targetScope=String(scopeId||'').trim();
  return featureNavigationHref(targetScope,'search',{identity:id});
}

export function mediaAnchorHref(scopeId,mediaId){
  const id=valueOf(mediaId);
  if(!id)return '';
  return featureNavigationHref(String(scopeId||'').trim(),'search',{media:id});
}

export function galaxyRelationLinks(scopeId,row={}){
  const links=[];
  const titles=row.relation_titles||{};
  const relatedTitle=id=>String(Object.prototype.hasOwnProperty.call(titles,id)?titles[id]||'':'').trim();
  const source=valueOf(row.source_id);
  if(source)links.push({id:'source:'+source,label:'上筆',title:relatedTitle(source),href:galaxyIdentityHref(scopeId,source)});
  const reference=valueOf(row.ref_id);
  if(reference)links.push({id:'reference:'+reference,label:'原始大綱／參考資料',title:relatedTitle(reference),href:galaxyIdentityHref(scopeId,reference)});
  const targets=normalizeRelationIds(row.target_id)||[];
  targets.forEach((target,index)=>{
    links.push({
      id:'target:'+target,
      label:targets.length===1?'下筆':`下筆 ${index+1}`,
      title:relatedTitle(target),
      href:galaxyIdentityHref(scopeId,target)
    });
  });
  return links.filter(link=>link.href);
}
