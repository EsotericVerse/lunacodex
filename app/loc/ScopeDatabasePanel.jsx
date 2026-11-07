'use client';
import {useEffect,useState} from 'react';
import {useUiText} from '../i18n/UiText';
import {mcpLocSession} from './mcp/loc-access.mjs';
import {scopeConfigRequest} from './mcp/scope-config-client.mjs';

const EMPTY={endpoint:'',schema:'public',table:''};

// Independent Scope records live in the Scope's existing DB table. Credentials
// are saved as HTTPS Gateway metadata in LOC Authority; no API key enters MCP chat.
export default function ScopeDatabasePanel({scopeId}){
  const t=useUiText();
  const label=key=>t('uiExtra.scopeSettings.'+key);
  const [values,setValues]=useState(EMPTY);
  const [configured,setConfigured]=useState(false);
  const [managed,setManaged]=useState(false);
  const [loadFailed,setLoadFailed]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState('');
  const change=(field,value)=>setValues(prev=>({...prev,[field]:value}));

  useEffect(()=>{
    let active=true;
    setValues({...EMPTY,table:scopeId+'_galaxy'});setConfigured(false);setManaged(false);setLoadFailed(false);
    setLoading(true);setStatus('');
    (async()=>{
      const {token}=await mcpLocSession();
      const data=await scopeConfigRequest({scopeid:scopeId,token});
      if(!active)return;
      setConfigured(Boolean(data.configured));setManaged(Boolean(data.managed));
      setValues({endpoint:String(data.endpoint||''),
        schema:String(data.schema||'public'),table:String(data.table||'')});
    })().catch(error=>{
      if(active){setLoadFailed(true);setStatus(error.message==='Scope Group authorization required'
        ?label('databaseDenied'):label('databaseLoadFailed'));}
    }).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[scopeId]);

  async function save(event){
    event.preventDefault();
    if(loading||saving)return;
    setSaving(true);setStatus('');
    try{
      const {token}=await mcpLocSession();
      const next=await scopeConfigRequest({scopeid:scopeId,
        token,values});
      setConfigured(Boolean(next.configured));
      setValues({endpoint:next.endpoint||'',schema:next.schema||'public',table:next.table||''});
      setStatus(label('databaseSaved'));
    }catch(error){
      setStatus(error.message==='Scope Group authorization required'
        ?label('databaseDenied'):label('databaseSaveFailed'));
    }finally{setSaving(false);}
  }

  return <section className="loc-card scope-feature-card" aria-label={label('databaseTitle')}>
    <h2>{label('databaseTitle')}</h2>
    <p className="scope-status">{label('databaseDesc')}</p>
    {loading?<p role="status" className="scope-status">{label('databaseLoading')}</p>:
      loadFailed?null:managed?<p className="scope-status" role="status">{label('databaseManaged')}</p>:
      <form className="scope-management-fields" onSubmit={save} autoComplete="off">
        <p className="scope-status" role="status">
          {configured?label('databaseStored'):label('databaseNotStored')}
        </p>
        <label><span>{label('databaseEndpoint')}</span>
          <input type="url" value={values.endpoint} required autoCapitalize="off"
            placeholder="https://gateway.lo3rwang.cc/v1/sql"
            onChange={event=>change('endpoint',event.target.value)}/>
        </label>
        <label><span>{label('databaseSchema')}</span>
          <input value={values.schema} required maxLength={63} autoCapitalize="off" spellCheck={false}
            onChange={event=>change('schema',event.target.value)}/>
        </label>
        <label><span>{label('databaseTable')}</span>
          <input value={values.table} required maxLength={63} autoCapitalize="off" spellCheck={false}
            onChange={event=>change('table',event.target.value)}/>
        </label>
        <div className="scope-management-wide-field">
          <p className="scope-status">{label('databaseNoNewTables')}</p>
          <button type="submit" className="loc-button" disabled={saving}>
            {saving?label('databaseSaving'):label('databaseSave')}
          </button>
        </div>
      </form>}
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </section>;
}
