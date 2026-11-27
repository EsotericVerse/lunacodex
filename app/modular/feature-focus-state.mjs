const DAY=/^\d{4}-\d{2}-\d{2}$/;
const FEATURE_IDS=new Set(['culture','trace','statics','search']);

function scopeIdOf(value){
  const id=String(value||'').trim().toLowerCase();
  return /^[a-z][a-z0-9]{0,14}$/.test(id)?id:'';
}

function normalizedRange(startDate,endDate){
  const start=String(startDate||'').trim();
  const end=String(endDate||'').trim();
  if((start&&!DAY.test(start))||(end&&!DAY.test(end))||(start&&end&&start>end))return null;
  return start||end?{startDate:start,endDate:end}:null;
}

export function createFeatureFocusState(scopeId=''){
  return {scopeId:scopeIdOf(scopeId),focus:null,article:null,dateRange:null};
}

function dateRangeForArticle(article){
  const day=String(article?.day||article?.date||'').slice(0,10);
  return DAY.test(day)?{startDate:day,endDate:day}:null;
}

function normalizeArticle(value,owner){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const uid=String(value.uid||value.articleUid||'').trim();
  if(!uid)return null;
  const longitude=Number(value.longitude??value.lng);
  const latitude=Number(value.latitude??value.lat);
  const hasCoordinates=Number.isFinite(longitude)&&Number.isFinite(latitude)&&
    Math.abs(longitude)<=180&&Math.abs(latitude)<=90;
  return {
    uid:uid.slice(0,240),
    scopeId:scopeIdOf(value.scopeId)||owner,
    title:String(value.title||uid).trim().slice(0,240),
    day:String(value.day||value.date||'').slice(0,10),
    ...(value.placeUid?{placeUid:String(value.placeUid).trim().slice(0,240)}:{}),
    ...(value.placeTitle?{placeTitle:String(value.placeTitle).trim().slice(0,240)}:{}),
    ...(value.placeScopeId?{placeScopeId:scopeIdOf(value.placeScopeId)||owner}:{}),
    ...(hasCoordinates?{longitude,latitude}:{}),
    ...(value.source?{source:String(value.source).trim().slice(0,240)}:{})
  };
}

export function featureArticleFromRow(row={},owner=''){
  const place=row?.trace_place||row?.tracePlace||null;
  const uid=String(row?.uid||row?.resourceId||row?.articleUid||'').trim();
  const title=String(row?.title||row?.name||uid).trim();
  const placeTitle=place?.title||row?.locationName||row?.location;
  return {
    uid,
    scopeId:String(row?.scopeId||row?.scope_id||owner||'').trim(),
    title,
    date:String(row?.article_day||row?.date||row?.createtime||row?.articleDay||'').slice(0,10),
    ...(place?.uid?{placeUid:place.uid}:{}),
    ...(placeTitle?{placeTitle}:{}),
    ...(place?.source_scope?{placeScopeId:place.source_scope}:{}),
    ...(place?.longitude!=null?{longitude:place.longitude}:{}),
    ...(place?.latitude!=null?{latitude:place.latitude}:{}),
    ...(row?.site||row?.source?{source:row.site||row.source}:{})
  };
}

export function featureFocusForScope(state,scopeId){
  const id=scopeIdOf(scopeId);
  return state?.scopeId===id&&id?state:null;
}

export function featureFocusReducer(state,action={}){
  const owner=scopeIdOf(action.scopeId);
  if(!owner)return state;
  if(action.type==='select'){
    const feature=String(action.feature||'');
    const kind=String(action.kind||'').trim();
    const id=String(action.id||'').trim();
    const label=String(action.label||'').trim();
    if(!FEATURE_IDS.has(feature)||!kind||!id||!label)return state;
    const existingArticle=state?.scopeId===owner&&state.article?.uid===id
      ?state.article:null;
    const nextArticle=Object.hasOwn(action,'article')
      ?normalizeArticle(action.article,owner)
      :kind==='article'
        ?existingArticle||normalizeArticle({uid:id,scopeId:owner,title:label},owner)
        :state?.scopeId===owner?state.article:null;
    const requestedRange=normalizedRange(action.startDate,action.endDate);
    const articleRange=nextArticle?dateRangeForArticle(nextArticle):null;
    return {
      scopeId:owner,
      focus:{feature,kind,id:id.slice(0,240),label:label.slice(0,240)},
      article:nextArticle,
      dateRange:requestedRange||articleRange||
        (state?.scopeId===owner?state.dateRange:null)
    };
  }
  if(action.type==='set-range'){
    if(!state?.focus||state.scopeId!==owner)return state;
    const range=normalizedRange(action.startDate,action.endDate);
    if(!range)return state;
    return {...state,dateRange:range};
  }
  if(action.type==='clear-range'){
    if(!state||state.scopeId!==owner||!state.dateRange)return state;
    return {...state,dateRange:null};
  }
  if(action.type==='clear'){
    if(state?.scopeId!==owner)return state;
    return createFeatureFocusState(owner);
  }
  return state;
}

export function featureFocusStatesReducer(states={},action={}){
  if(action.type==='carry'){
    const from=scopeIdOf(action.fromScopeId),to=scopeIdOf(action.toScopeId);
    const source=states[from];
    if(!source||!to||!source.focus)return states;
    const current=states[to]||createFeatureFocusState(to);
    const article=source.article||null;
    const feature=FEATURE_IDS.has(String(action.feature||''))
      ?String(action.feature):source.focus.feature;
    const focus=article?{feature,kind:'article',id:article.uid,label:article.title}
      :{...source.focus,feature};
    const next={...current,focus,article,dateRange:source.dateRange||null};
    return {...states,[to]:next};
  }
  const owner=scopeIdOf(action.scopeId);
  if(!owner)return states;
  const current=states[owner]||createFeatureFocusState(owner);
  const next=featureFocusReducer(current,action);
  return next===current?states:{...states,[owner]:next};
}

export function featureFocusRangeFromRow(row){
  const startDate=String(row?.start_date||row?.start||row?.date||'').slice(0,10);
  const endDate=String(row?.end_date||row?.end||startDate).slice(0,10);
  return DAY.test(startDate)&&DAY.test(endDate)&&startDate<=endDate
    ?{startDate,endDate}:null;
}

export function rowsWithinFeatureFocusRange(rows=[],range=null){
  const list=Array.isArray(rows)?rows:[];
  const bounded=normalizedRange(range?.startDate,range?.endDate);
  if(!bounded)return list;
  const dated=list.map(row=>({row,range:featureFocusRangeFromRow(row)}))
    .filter(entry=>entry.range);
  if(!dated.length)return list;
  const loadedStart=dated.reduce((min,entry)=>entry.range.startDate<min?entry.range.startDate:min,dated[0].range.startDate);
  const loadedEnd=dated.reduce((max,entry)=>entry.range.endDate>max?entry.range.endDate:max,dated[0].range.endDate);
  if((bounded.startDate&&bounded.startDate<loadedStart)||
     (bounded.endDate&&bounded.endDate>loadedEnd))return list;
  return dated.filter(entry=>(!bounded.startDate||entry.range.endDate>=bounded.startDate)&&
    (!bounded.endDate||entry.range.startDate<=bounded.endDate)).map(entry=>entry.row);
}
