// Public LOC autocomplete and Anchor navigation using already-public data.
// No SQL Gateway, no privileged connection, no additional database policies.
import {PUBLISHED_SOURCE_ENTRIES,PUBLISHED_SOURCE_DOMAINS} from '../modular/published-source-taxonomy.js';
import {PUBLISHED_SEARCH_KEYWORDS} from '../modular/published-search-keywords.js';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const TYPES=['date','point','from','domain','item','pattern'];
const normalize=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const scopesOf=values=>[...new Set((Array.isArray(values)?values:[])
  .map(value=>String(value||'')).filter(value=>SCOPE.test(value)))].slice(0,50);
const dateValue=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
const escapedLike=value=>String(value).replace(/[\\%_*]/g,c=>'\\'+c);

export function publicPublishedAnchorSuggestions(scopeIds,rawQuery){
  const query=normalize(rawQuery);
  if(!query||query.length>120)return [];
  const out=[];
  for(const scope of scopesOf(scopeIds)){
    const published=PUBLISHED_SEARCH_KEYWORDS[scope]||{};
    for(const [uid,title,terms] of published.item||[]){
      if(UID.test(uid)&&normalize(title).includes(query))
        out.push({scopeId:scope,uid,type:'item',title,terms});
    }
    for(const [uid,title] of published.pattern||[]){
      if(UID.test(uid)&&normalize(title).includes(query))
        out.push({scopeId:scope,uid,type:'pattern',title});
    }
    for(const source of PUBLISHED_SOURCE_ENTRIES[scope]||[]){
      if(UID.test(source.uid)&&(normalize(source.name).includes(query)||
          normalize(source.label).includes(query)))
        out.push({scopeId:scope,uid:source.uid,type:'from',title:source.name});
    }
    const domain=PUBLISHED_SOURCE_DOMAINS[scope];
    if(UID.test(String(domain||''))&&normalize(scope).includes(query))
      out.push({scopeId:scope,uid:domain,type:'domain',title:scope});
  }
  return out;
}

export async function suggestPublicAnchors(scopeIds,rawQuery,{client}={}){
  const query=normalize(rawQuery);
  if(!query)return [];
  if(query.length>120)throw Error('Invalid autocomplete query');
  const scopes=scopesOf(scopeIds);
  const publicTerms=publicPublishedAnchorSuggestions(scopes,query);
  // A failed optional date/place lookup must never block the text search or
  // the published Source/Keyword suggestions.
  const live=await Promise.all(scopes.map(async scope=>{
    try{
      if(!client?.schema)return [];
      const result=await client.schema('silver').from(scope+'_anchor')
        .select('uid,type,title,attr,invisible')
        .in('type',['date','point']).eq('invisible',false)
        .ilike('title','%'+escapedLike(query)+'%')
        .order('title',{ascending:true}).limit(20);
      return (result.data||[]).filter(row=>UID.test(String(row.uid))&&
        ['date','point'].includes(row.type)&&row.invisible===false).map(row=>{
        const attrs=typeof row.attr==='string'?JSON.parse(row.attr):row.attr||{};
        const date=String(attrs.date||'');
        return {scopeId:scope,uid:row.uid,type:row.type,
          title:String(row.title||''),...(row.type==='date'&&dateValue(date)?{date}:{})};
      });
    }catch{return [];}
  }));
  const matches=new Map();
  for(const row of [...publicTerms,...live.flat()])
    matches.set(row.scopeId+':'+row.type+':'+row.uid,row);
  return [...matches.values()].sort((a,b)=>{
    const starts=Number(normalize(b.title).startsWith(query))-
      Number(normalize(a.title).startsWith(query));
    return starts||TYPES.indexOf(a.type)-TYPES.indexOf(b.type)||
      a.title.localeCompare(b.title);
  }).slice(0,36);
}

export function publicKeywordQuery(selection){
  if(!selection||!['item','pattern'].includes(selection.type))return '';
  const terms=selection.type==='pattern'?[selection.title]:selection.terms||[selection.title];
  const words=[...new Set(terms.map(s=>String(s||'').trim())
    .filter(Boolean))].slice(0,30);
  // The existing query parser treats quotes as literal phrase tokens, and |
  // as OR. No additional private Index/Postings read is required.
  return words.map(term=>'"'+term.replace(/["“”]/g,'')+'"')
    .filter(term=>term!=='""').join(' | ');
}

export async function readPublicAnchorArticles(selection,options={},client){
  const scope=String(selection?.scopeId||''),uid=String(selection?.uid||'');
  const type=String(selection?.type||'');
  if(!client?.schema||!SCOPE.test(scope)||!UID.test(uid)||
    !['date','point','from','domain'].includes(type))
    throw Error('Invalid public Anchor choice');
  const offset=Number(options.offset??0),limit=Number(options.limit??20);
  if(!Number.isSafeInteger(offset)||offset<0||offset>200000||
    !Number.isSafeInteger(limit)||limit<1||limit>100)
    throw Error('Invalid public Anchor page');
  const sourceList=PUBLISHED_SOURCE_ENTRIES[scope]||[];
  const source=type==='from'?sourceList.find(item=>item.uid===uid):null;
  const domain=PUBLISHED_SOURCE_DOMAINS[scope];
  if(type==='from'&&!source)throw Error('Unpublished Source choice');
  if(type==='domain'&&domain!==uid)throw Error('Unpublished Source category');
  if(type==='date'&&!dateValue(selection.date))throw Error('Invalid date Anchor');
  let query=client.schema('silver').from(scope+'_galaxy')
    .select('uid,title,date,createtime,site,url,location,place_id,search,statics,culture,trace,list,keyword,extract,others')
    .eq('search',true);
  if(type==='date')query=query.eq('date',selection.date);
  if(type==='point')query=query.eq('place_id',uid);
  if(type==='from')query=query.eq('site',source.name);
  if(type==='domain'){
    const names=sourceList.map(item=>item.name).filter(Boolean);
    if(!names.length)return {rows:[],hasMore:false,nextOffset:null};
    query=query.in('site',names);
  }
  for(const [name,operator] of [['startDate','gte'],['endDate','lte']]){
    const value=String(options[name]||'');
    if(value){
      if(!dateValue(value))throw Error('Invalid date filter');
      query=query[operator]('date',value);
    }
  }
  if(options.contentType==='lyrics_work')query=query.eq('site','suno');
  if(options.contentType==='text_work')query=query.neq('site','suno');
  const sourceFilter=String(options.sourceFilter||'');
  if(sourceFilter.startsWith('source:')){
    if(sourceFilter.length>157)throw Error('Invalid source filter');
    query=query.eq('site',sourceFilter.slice(7));
  }
  query=query.order('createtime',{ascending:options.sortDirection==='asc'})
    .range(offset,offset+limit);
  const result=await query;
  if(result.error)throw Error(result.error.message||'Public Anchor read failed');
  const found=Array.isArray(result.data)?result.data:[];
  const hasMore=found.length>limit;
  return {rows:found.slice(0,limit).map(row=>({
    row:{...row,scope_id:scope,__table:'silver.'+scope+'_galaxy'},
    source:String(row.site||scope)
  })),hasMore,nextOffset:hasMore?offset+limit:null};
}
