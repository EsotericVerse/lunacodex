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
  return {scopeId:scopeIdOf(scopeId),focus:null,dateRange:null};
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
    return {
      scopeId:owner,
      focus:{feature,kind,id:id.slice(0,240),label:label.slice(0,240)},
      dateRange:null
    };
  }
  if(action.type==='set-range'){
    if(!state?.focus||state.scopeId!==owner)return state;
    const range=normalizedRange(action.startDate,action.endDate);
    if(!range)return state;
    return {...state,dateRange:range};
  }
  if(action.type==='clear'){
    if(state?.scopeId!==owner)return state;
    return createFeatureFocusState(owner);
  }
  return state;
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
