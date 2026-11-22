// Compact first view of article sources. The sole classification hierarchy is
// the LOC-wide SiteAnchor tree in silver.loc_anchor; all counts come from
// the actual Galaxy.site daily aggregate, including Suno/Spotify/Youtube.
import {assignedSource} from '../statistics/member-intersection-model.mjs';

function sourceRootFor(site,taxonomy={}){
  const categories=taxonomy.categories||[];
  const code=assignedSource(site,taxonomy.aliases||[],categories);
  const modeled=categories.find(row=>row.category_code===code);
  return modeled?.root||(modeled?'system':'custom');
}

export function summarizeCultureRiverRoots(rows=[],taxonomy={}){
  const daily=new Map(),groups=new Map();
  for(const row of rows){
    if(row?.kind!=='source')continue;
    const category=String(row.category||'').trim();
    const day=String(row.day||'').slice(0,10);
    const count=Number(row.item_count)||0;
    if(count<=0||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
    const root=sourceRootFor(category,taxonomy);
    const key='source:'+category;
    const group=groups.get(key)||{
      category_key:key,category_type:'source',site:category,
      display_label:category,item_count:0,sites:[category]
    };
    group.item_count+=count;groups.set(key,group);
    const bucketKey=root+'\u0000'+day;
    daily.set(bucketKey,(daily.get(bucketKey)||0)+count);
  }
  return {
    rootBuckets:[...daily].map(([key,item_count])=>{
      const [category,start_date]=key.split('\u0000');
      return {category,start_date,item_count};
    }).sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.category.localeCompare(b.category)),
    groups:[...groups.values()].sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site))
  };
}

// The collapsed source river is a total by Galaxy.site, not a separate
// MediaAnchor or media_type summary. There is no second source taxonomy.
export function buildCultureRiverRootTotals({text=[]}={},taxonomy={}){
  const groups=new Map();
  for(const row of text){
    const category=String(row?.category||'').trim();
    const count=Number(row?.item_count)||0;
    if(count<=0)continue;
    const key='source:'+category;
    const group=groups.get(key)||{
      category_key:key,category_type:'source',site:category,
      display_label:category,item_count:0,sites:[category]
    };
    group.item_count+=count;groups.set(key,group);
  }
  return {groups:[...groups.values()].sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site))};
}

export function selectCultureRiverChildren(rows=[],taxonomy={},roots=[]){
  const wanted=new Set(roots);
  return rows.filter(row=>row?.kind==='source'&&
    wanted.has(sourceRootFor(String(row.category||'').trim(),taxonomy)));
}

/**
 * Reuse one bounded Galaxy.site daily aggregate for initial parent lanes and
 * clicked children. No article text, media counters, extra SQL, or ISR cache.
 */
export function buildCultureRiverRootPayload({text=[]}={},taxonomy={}){
  const numericRows=(Array.isArray(text)?text:[]).map(row=>({
    kind:'source',day:String(row?.day||''),category:String(row?.category||''),
    item_count:Number(row?.item_count)||0
  }));
  return {...summarizeCultureRiverRoots(numericRows,taxonomy),numericRows};
}
