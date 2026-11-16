'use client';
import {useState} from 'react';
import {useAccount} from '../auth/use-account';
import {useUiText} from '../../i18n/UiText';
import ScopeDatabasePanel from './ScopeDatabasePanel';
import ScopeGroupAccessPanel from './ScopeGroupAccessPanel';

const ID=/^[a-z][a-z0-9]{0,14}$/;
// This entry is independent of legacy SQL/email management privileges.
// Individual Scope or Group permissions are verified by LOC Authority on use.
export default function LocScopeConnections({availableScopes=[],verifiedAccount=null}){
  const ui=useUiText();
  const t=key=>ui('uiExtra.globalSettings.'+key);
  // The settings homepage already has a verified LOC Auth Session. Displaying
  // identity must not require an MCP access token or a second identity lookup.
  // The protected API still validates the actual operation independently.
  const localAccount=useAccount({enabled:!verifiedAccount,sessionOnly:true});
  const account=verifiedAccount||localAccount;
  const principal=String(account?.user?.id||'');
  const loading=Boolean(account?.loading);
  const [scopeId,setScopeId]=useState('lo3rwang');
  const [groupId,setGroupId]=useState('loc');
  const [active,setActive]=useState(null);
  const [status,setStatus]=useState('');
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
        principal?<p>{t('mcpLocId')}：<code>{principal}</code></p>:
          <p role="status">{account?.error?String(account.error):t('mcpSignInNeeded')}
            {' '}<a href="/login/index.html?return_to=%2Flocal%2Fsettings%2F">{t('login')}</a>
          </p>}
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
