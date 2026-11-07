'use client';
import {useEffect,useState} from 'react';
import {useUiText} from '../i18n/UiText';
import {mcpLocSession} from './mcp/loc-access.mjs';
import ScopeDatabasePanel from './ScopeDatabasePanel';
import ScopeGroupAccessPanel from './ScopeGroupAccessPanel';

const ID=/^[a-z][a-z0-9]{0,14}$/;
// This entry is independent of legacy SQL/email management privileges.
// Individual Scope or Group permissions are verified by LOC Authority on use.
export default function LocScopeConnections({availableScopes=[]}){
  const ui=useUiText();
  const t=key=>ui('uiExtra.globalSettings.'+key);
  const [principal,setPrincipal]=useState('');
  const [scopeId,setScopeId]=useState('lo3rwang');
  const [groupId,setGroupId]=useState('loc');
  const [active,setActive]=useState(null);
  const [status,setStatus]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let current=true;
    mcpLocSession().then(({subject})=>{if(current)setPrincipal(subject);})
      .catch(()=>{if(current)setPrincipal('');})
      .finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[]);
  const open=(kind,id)=>{
    if(!ID.test(id)){setStatus(t('mcpInvalidScope'));return;}
    setStatus('');
    setActive({kind,id});
  };
  return <div className="loc-settings-panel-group">
    <section className="loc-card">
      <h2>{t('mcpSelfServiceTitle')}</h2>
      <p className="scope-status">{t('mcpSelfServiceIntro')}</p>
      {loading?<p role="status">{t('loading')}</p>:
        principal?<p>{t('mcpClerkId')}：<code>{principal}</code></p>:
          <p role="status">{t('mcpSignInNeeded')} <a href="/login/index.html?return_to=%2Flocal%2Fsettings%2F">{t('login')}</a></p>}
      {principal?<div className="scope-management-fields">
        <label><span>{t('mcpScopeId')}</span>
          <input list="loc-mcp-scope-choices" value={scopeId}
            onChange={e=>setScopeId(e.target.value.toLowerCase().trim())}
            autoCapitalize="off" spellCheck={false}/>
          <datalist id="loc-mcp-scope-choices">
            {availableScopes.filter(x=>ID.test(String(x.id||''))).map(x=>
              <option key={x.id} value={x.id}>{x.label||x.id}</option>)}
          </datalist>
        </label>
        <button type="button" className="loc-button"
          onClick={()=>open('scope',scopeId)}>{t('mcpOpenScope')}</button>
        <label><span>{t('mcpGroupId')}</span>
          <input value={groupId} onChange={e=>setGroupId(e.target.value.toLowerCase().trim())}
            autoCapitalize="off" spellCheck={false}/>
        </label>
        <button type="button" className="loc-button"
          onClick={()=>open('group',groupId)}>{t('mcpOpenGroup')}</button>
      </div>:null}
      {status?<p role="status" className="scope-status">{status}</p>:null}
    </section>
    {principal&&active?.kind==='scope'?<ScopeDatabasePanel key={'scope-'+active.id} scopeId={active.id}/>:null}
    {principal&&active?.kind==='group'?<ScopeGroupAccessPanel key={'group-'+active.id} groupId={active.id}/>:null}
  </div>;
}
