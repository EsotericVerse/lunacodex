'use client';
import {useEffect,useState} from 'react';
import {mcpLocSession} from '../../mcp/loc-access.mjs';

// The upstream MCP Provider console is separate from LOC Auth's identity UI.
// No OAuth credentials are visible or entered in this browser.
const API='/api/mcp-provider';
async function providerRequest(action,payload=null){
  const {token}=await mcpLocSession();
  const url=API+'?action='+encodeURIComponent(action)+
    (payload?.provider&&action==='tools'?'&provider='+encodeURIComponent(payload.provider):'');
  const response=await fetch(url,{
    method:payload&&action!=='tools'?'POST':'GET',
    credentials:'include',cache:'no-store',redirect:'error',
    headers:{authorization:'Bearer '+token,accept:'application/json',
      ...(payload&&action!=='tools'?{'content-type':'application/json'}:{})},
    ...(payload&&action!=='tools'?{body:JSON.stringify({action,...payload})}:{}),
    signal:AbortSignal.timeout(20000)
  });
  const value=await response.json().catch(()=>null);
  if(!response.ok)throw Error(String(value?.error||'LOC MCP Provider request failed'));
  return value;
}
export default function McpProviderPanel(){
  const [providers,setProviders]=useState([]);
  const [ready,setReady]=useState(false);
  const [selected,setSelected]=useState('');
  const [tools,setTools]=useState([]);
  const [pending,setPending]=useState([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function refresh(){
    const info=await providerRequest('status');
    setProviders(info.providers||[]);setReady(info.ready===true);
  }
  useEffect(()=>{
    let active=true;
    providerRequest('status').then(info=>{
      if(!active)return;
      setProviders(info.providers||[]);setReady(info.ready===true);
    }).catch(error=>{if(active)setMessage(String(error.message||error))});
    return ()=>{active=false};
  },[]);
  async function run(label,work){
    if(busy)return;
    setBusy(true);setMessage(label);
    try{const result=await work();setMessage('LOC MCP：操作完成');return result}
    catch(error){setMessage('LOC MCP：'+String(error.message||error));return null}
    finally{setBusy(false)}
  }
  const current=providers.find(item=>item.id===selected);
  async function connect(id){
    const result=await run('正在建立 '+id+' 授權…',()=>
      providerRequest('connect',{provider:id}));
    if(result?.authorize_url)window.location.assign(result.authorize_url);
  }
  async function select(id){
    setSelected(id);setTools([]);
    const result=await run('正在讀取 '+id+' 的函式清單…',()=>
      providerRequest('tools',{provider:id}));
    if(result)setTools(result.tools||[]);
  }
  async function changePolicy(name,mode){
    const result=await run('正在更新函式政策…',()=>
      providerRequest('policy',{provider:selected,tool:name,mode}));
    if(result)await refresh();
  }
  async function loadPending(){
    const result=await run('正在讀取待核准操作…',()=>
      providerRequest('pending'));
    if(result)setPending(result.items||[]);
  }
  async function decide(id,yes){
    const result=await run(yes?'正在執行已批准操作…':'正在拒絕操作…',()=>
      providerRequest(yes?'approve':'reject',{id}));
    if(result)await loadPending();
  }
  return <section className="loc-card admin-workspace" aria-labelledby="admin-mcp-provider-heading">
    <h2 id="admin-mcp-provider-heading">LOC MCP · 上游 Provider</h2>
    <p className="scope-status">LOC Auth 確認身分；此處管理外部 MCP 授權及各函式的自動執行／逐次詢問／禁止。沒有定時輪詢，不影響現有 SQL Model。</p>
    {!ready?<p className="scope-status" role="status">MCP Provider Vault 尚未在運行環境啟用；目前不可連線。現有 LOC MCP 工具不受影響。</p>:null}
    <p role="status" className="scope-status">{message}</p>
    <div className="scope-management-fields">
      {providers.map(item=><div className="loc-card" key={item.id}>
        <h3>{item.label}</h3>
        <p className="scope-status">{item.connected?'已取得委託授權':'尚未授權'}</p>
        {item.connected?<div className="scope-management-fields">
          <button className="loc-button" type="button" disabled={busy}
            onClick={()=>select(item.id)}>管理函式</button>
          <button className="loc-button" type="button" disabled={busy}
            onClick={()=>run('正在取消 LOC 委託…',async()=>{
              await providerRequest('disconnect',{provider:item.id});
              if(selected===item.id){setSelected('');setTools([])}
              await refresh();
            })}>中斷 LOC 委託</button>
        </div>:<button className="loc-button" type="button" disabled={!ready||busy}
          onClick={()=>connect(item.id)}>連線並授權</button>}
      </div>)}
    </div>
    {current?.connected?<section className="loc-card" aria-label="函式政策">
      <h3>{current.label} · 函式政策</h3>
      <p className="scope-status">新函式預設禁止；必須明確指定才可執行。</p>
      {tools.map(tool=><div key={tool.name} className="scope-management-fields">
        <div><strong>{tool.name}</strong><p className="scope-status">{tool.description}</p></div>
        <label><span>執行政策</span>
          <select className="scope-select" disabled={busy}
            value={current.policies?.[tool.name]||'deny'}
            onChange={event=>changePolicy(tool.name,event.target.value)}>
            <option value="deny">禁止</option>
            <option value="ask">每次詢問</option>
            <option value="auto">自動執行</option>
          </select>
        </label>
      </div>)}
    </section>:null}
    <section className="loc-card" aria-label="待批准函式">
      <h3>逐次批准</h3>
      <button className="loc-button" type="button" disabled={!ready||busy}
        onClick={loadPending}>手動更新待批准操作</button>
      {pending.map(item=><div className="loc-card" key={item.id}>
        <p><strong>{item.provider} · {item.tool}</strong></p>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'160px',overflow:'auto'}}>{JSON.stringify(item.args,null,2)}</pre>
        <p className="scope-status">僅核准這一次、這組參數，不變更函式預設政策。</p>
        <button className="loc-button" type="button" disabled={busy}
          onClick={()=>decide(item.id,true)}>同意並執行</button>{' '}
        <button className="loc-button" type="button" disabled={busy}
          onClick={()=>decide(item.id,false)}>拒絕</button>
      </div>)}
    </section>
  </section>;
}
