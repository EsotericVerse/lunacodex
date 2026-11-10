// Compact, public-only first view. Detail remains on the server until expanded.
import {assignedSource} from './member-intersection-model.mjs';
export function summarizeCultureRiverRoots(rows=[],taxonomy={}){
  const daily=new Map(),groups=new Map();
  for(const row of rows){
    if(row?.kind!=='source'&&row?.kind!=='media')continue;
    const category=String(row.category||'').trim(),day=String(row.day||'').slice(0,10),count=Number(row.item_count)||0;
    if(count<=0)continue;
    const isMedia=row.kind==='media';if(isMedia&&!category)continue;
    // Count only records with an actual date in the selected interval.
    // Undated results must not create clickable but empty child lanes.
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
    const raw=isMedia?'媒體 · '+category:category;
    const root=isMedia?'media':assignedSource(category,taxonomy.aliases||[],taxonomy.categories||[])==='unclassified'?'custom':'system';
    const key=(isMedia?'media:':'source:')+category;
    const group=groups.get(key)||{
      category_key:'source:'+raw,category_type:isMedia?'media':'source',site:raw,
      display_label:raw,item_count:0,sites:isMedia?[]:[category],media_types:isMedia?[category]:[]
    };
    group.item_count+=count;groups.set(key,group);
    const bucketKey=root+'\u0000'+day;
    daily.set(bucketKey,(daily.get(bucketKey)||0)+count);
  }
  return {
    rootBuckets:[...daily].map(([key,item_count])=>{
      const [category,start_date]=key.split('\u0000');return {category,start_date,item_count};
    }).sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.category.localeCompare(b.category)),
    groups:[...groups.values()].sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site))
  };
}

// Totals-only root payload: one group per source/media category with its
// total item_count, no per-day buckets. Used for the collapsed river's flat
// water-level bars -- the daily breakdown is fetched separately, only once
// a lane is expanded (see selectScopeCategoryTotals / galaxy-query.js).
export function buildCultureRiverRootTotals({text=[],media=[]}={},taxonomy={}){
  const groups=new Map();
  const add=(category,count,isMedia)=>{
    category=String(category||'').trim();
    if(count<=0)return;
    // An empty media_type has nothing to label a lane with and must not
    // create a clickable-but-empty child; an empty site is real
    // (unclassified text), same as summarizeCultureRiverRoots above.
    if(isMedia&&!category)return;
    if(isMedia){
      const raw='媒體 · '+category;
      const key='media:'+category;
      const group=groups.get(key)||{
        category_key:'source:'+raw,category_type:'media',site:raw,
        display_label:raw,item_count:0,sites:[],media_types:[category]
      };
      group.item_count+=count;groups.set(key,group);
      return;
    }
    const key='source:'+category;
    const group=groups.get(key)||{
      category_key:'source:'+category,category_type:'source',site:category,
      display_label:category,item_count:0,sites:[category],media_types:[]
    };
    group.item_count+=count;groups.set(key,group);
  };
  for(const row of text)add(row?.category,Number(row?.item_count)||0,false);
  for(const row of media)add(row?.category,Number(row?.item_count)||0,true);
  return {groups:[...groups.values()].sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site))};
}

export function selectCultureRiverChildren(rows=[],taxonomy={},roots=[]){
  const wanted=new Set(roots);
  return rows.filter(row=>{
    if(row?.kind==='media')return wanted.has('media');
    if(row?.kind!=='source')return false;
    const root=assignedSource(String(row.category||'').trim(),taxonomy.aliases||[],taxonomy.categories||[])==='unclassified'?'custom':'system';
    return wanted.has(root);
  });
}

/**
 * Reuse ONE time-bounded DB aggregate for the initial parent lanes and
 * clicked children. The first paint consumes rootBuckets/groups only; the
 * compact numericRows remain in the shared client query until a parent expands.
 *
 * No article text, extra SQL request, or remote ISR cache is involved.
 */
export function buildCultureRiverRootPayload({text=[],media=[]}={},taxonomy={}){
  const numericRows=[
    ...(Array.isArray(text)?text:[]).map(row=>({
      kind:'source',day:String(row?.day||''),category:String(row?.category||''),
      item_count:Number(row?.item_count)||0
    })),
    ...(Array.isArray(media)?media:[]).map(row=>({
      kind:'media',day:String(row?.day||''),category:String(row?.category||''),
      item_count:Number(row?.item_count)||0
    }))
  ];
  return {...summarizeCultureRiverRoots(numericRows,taxonomy),numericRows};
}
