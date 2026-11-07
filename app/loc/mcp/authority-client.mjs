// One server for independent Scopes. The Group Authority verifies the Clerk
// OAuth token and permissions on EVERY call; credentials never reach MCP replies.
const DEFAULT_AUTHORITY='https://auth.lo3rwang.cc';
const PR_SEARCH_WARNING='請至github頁面找尋PR相關資料！不開放搜尋PR!';
const ORIGIN='https://loc.lo3rwang.cc';
const ID=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
function bad(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENT'});}
function id(value){if(!ID.test(String(value||'')))throw bad('Invalid Scope or Group ID');return value;}
function target(value,env){
  const url=new URL(String(env.LOC_MCP_AUTHORITY_URL||DEFAULT_AUTHORITY));
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !['','/'].includes(url.pathname))throw Error('Invalid LOC Authority origin');
  return new URL('/v1/mcp/'+value,url.origin);
}
export async function authorityAction(name,args,token,env={},fetchImpl=globalThis.fetch){
  if(typeof token!=='string'||!token.startsWith('eyJ'))
    throw bad('Authenticated Clerk OAuth required');
  const a=args||{};
  let path='',method='GET',body=null,query=null;
  if(name==='galaxy_link'){
    if(a.action==='update_pr')throw bad(PR_SEARCH_WARNING);
    if(!['search','read','check','record'].includes(a.action))throw bad('Invalid Galaxy Link action');
    if(a.source!==undefined)throw bad('Galaxy Link source is fixed to mcp');
    if(a.action==='search'){
      if(/(?:\bPR\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(String(a.query||'')))
        throw bad(PR_SEARCH_WARNING);
      if(a.user_requested!==true)
        throw bad('只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。');
      if(typeof a.query!=='string'||a.query.trim().length<2||a.query.length>100||
        !Number.isInteger(a.limit??5)||(a.limit??5)<1||(a.limit??5)>5)
        throw bad('Invalid Galaxy Link search');
      path='search/'+id(a.scopeid);method='POST';
      body={query:a.query,limit:a.limit??5,user_requested:true};
    }else if(a.action==='read'){
      if(!UID.test(String(a.uid||'')))throw bad('Invalid case-sensitive UID');
      path='read/'+id(a.scopeid)+'/'+a.uid;
      query={offset:a.offset??0,max_chars:a.max_chars??20000,site:'mcp'};
    }else if(a.action==='check'){
      if(!a.conversation_id||!a.updated_at)throw bad('conversation_id and updated_at required');
      path='checkpoint/'+id(a.scopeid)+'/'+encodeURIComponent(String(a.conversation_id));
      query={updated_at:a.updated_at};
    }else{
      if(!a.conversation_id||!a.updated_at||!Array.isArray(a.records)||
        !a.records.length||a.records.length>100)throw bad('Source records required');
      const records=a.records;
      if(records.some(row=>!row||typeof row!=='object'||
          !['user','assistant'].includes(row.role)||
          row.role==='user'&&row.kind!=='original'||
          row.role==='assistant'&&row.kind!=='advice'||
          typeof row.text!=='string'||!row.text.length||
          typeof row.message_id!=='string'||!row.message_id||
          typeof row.sent_at!=='string'||!Number.isFinite(Date.parse(row.sent_at))))
        throw bad('Only timestamped original user messages or real assistant advice may be recorded');
      const digestInput=new TextEncoder().encode(JSON.stringify([a.conversation_id,...records]));
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',digestInput));
      const batchId=[...digest].map(n=>n.toString(16).padStart(2,'0')).join('');
      const marker='[[GalaxyLinkBatch:'+batchId+']]';
      const content=marker+'\n'+records.map(row=>'['+new Date(row.sent_at).toISOString()+'] '+
        (row.role==='user'?'user':'assistant:advice')+' #'+row.message_id+'\n'+row.text).join('\n\n');
      if(content.length>125000)throw bad('Source batch too large');
      path='sync/'+id(a.scopeid);method='POST';
      body={conversation_id:a.conversation_id,updated_at:a.updated_at,
        created_at:a.created_at,title:a.title||'',content,batch_id:batchId,
        ...(a.uid?{uid:a.uid}:{}),append:true};
    }
    // A dedicated versioned route fails closed against old Authority deployments.
    path='galaxy-link/'+path;
  }else switch(name){
    case 'scope_storage':
      path='scope/'+id(a.scopeid);
      if(a.endpoint!==undefined){
        method='PUT';
        // Database credentials are accepted only by the secure Clerk UI ->
        // Authority HTTPS endpoint, never as ChatGPT/MCP tool arguments.
        body={endpoint:a.endpoint,schema:a.schema||'public',table:a.table};
        if(!body.table||!body.endpoint)throw bad('Database endpoint and existing table are required');
      }
      break;
    case 'join_scope_group':
      path='group/'+id(a.groupid)+'/scope/'+id(a.scopeid);method='PUT';
      body={};break;
    case 'grant_scope_access':
      path='group/'+id(a.groupid)+'/grant';method='PUT';
      if(!/^user_[A-Za-z0-9]+$/.test(String(a.subject||'')))throw bad('Valid Clerk user subject required');
      if(!Array.isArray(a.actions)||a.actions.length===0||
        a.actions.some(x=>!['read','write','manage','configure'].includes(x)))
        throw bad('Invalid Authority actions');
      const days=Number(a.days||30);
      if(!Number.isInteger(days)||days<1||days>365)throw bad('Grant days must be 1–365');
      body={subject:a.subject,scope:id(a.scopeid),actions:a.actions,
        expires_at:Date.now()+days*86400000};break;
    case 'revoke_scope_access':
      path='group/'+id(a.groupid)+'/revoke';method='POST';
      if(!/^user_[A-Za-z0-9]+$/.test(String(a.subject||'')))throw bad('Valid Clerk user subject required');
      body={scope:id(a.scopeid),subject:a.subject};break;
    default:throw bad('Unknown LOC MCP action');
  }
  const url=target(path,env);
  for(const [key,val] of Object.entries(query||{})){
    if(val!==undefined)url.searchParams.set(key,String(val));
  }
  const res=await fetchImpl(url.toString(),{
    method,headers:{authorization:'Bearer '+token,origin:ORIGIN,
      accept:'application/json',...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(16000)
  });
  if(!res.ok){
    let message='LOC Authority denied or unavailable (HTTP '+res.status+')';
    if(res.status>=400&&res.status<500){
      const data=await res.json().catch(()=>null);
      if(typeof data?.error==='string')message=data.error.slice(0,180);
    }
    throw Object.assign(new Error(message),{code:'AUTHORITY_ERROR',httpStatus:res.status});
  }
  const data=await res.json();
  const rawNotice=res.headers.get('x-loc-qos-warning');
  if(rawNotice&&data&&typeof data==='object'&&!Array.isArray(data)){
    try{return {...data,warning:decodeURIComponent(rawNotice)};}catch{}
  }
  return data;
}
