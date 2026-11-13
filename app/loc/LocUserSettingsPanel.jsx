'use client';
import {useEffect,useRef,useState} from 'react';
import {useUiSection} from '../i18n/ui-locale';
import {useUiText} from '../i18n/UiText';
import {registerDefaultSection} from '../i18n/ui-copy';
import globalSettingsZh from '../i18n/sections/uiExtra.globalSettings.zh_tw.js';
import useLocUser from './use-loc-user';
import {LOC_USER_DEFAULTS} from './loc-user-store.mjs';
registerDefaultSection('uiExtra.globalSettings',globalSettingsZh);

const PATH='uiExtra.globalSettings.';
const FIELDS=Object.freeze([
  {key:'culture',title:'cultureSettings',fields:[
    {key:'time',title:'cultureTime',options:[['anchor','prefAnchor'],['period','prefPeriod'],['era','prefEraDefault']]},
    {key:'display',title:'cultureDisplay',options:[['density','prefDensityDefault'],['keywords','prefKeywords']]},
    {key:'unit',title:'cultureUnit',options:[['day','prefDayDefault'],['week','prefWeek'],['month','prefMonth'],['year','prefYear']]},
    {key:'sort',title:'cultureSort',options:[['desc','prefLatestDefault'],['asc','prefOldest']]},
    {key:'list',title:'featureListTitle',checkbox:true}
  ]},
  {key:'trace',title:'traceSettings',fields:[
    {key:'display',title:'traceDisplay',options:[['anchor','prefAnchorDefault'],['path','prefPath'],['trace','prefTrace']]},
    {key:'time',title:'traceTime',options:[['none','prefNoneDefault'],['period','prefPeriod'],['era','prefEra']]},
    {key:'sort',title:'traceSort',options:[['desc','prefLatestDefault'],['nearest','prefNearest']]},
    {key:'list',title:'featureListTitle',checkbox:true}
  ]},
  {key:'statics',title:'staticsSettings',fields:[
    {key:'display',title:'staticsDisplay',options:[['source','prefSourceDefault'],['media_type','prefMedia']]},
    {key:'unit',title:'staticsUnit',options:[['day','prefDayDefault'],['week','prefWeek'],['month','prefMonth'],['year','prefYear']]},
    {key:'sort',title:'staticsSort',options:[['desc','prefLatestDefault'],['asc','prefOldest']]},
    {key:'list',title:'featureListTitle',checkbox:true}
  ]},
  {key:'search',title:'searchSettings',fields:[
    {key:'sort',title:'searchSort',options:[['asc','prefOldestDefault'],['desc','prefLatest']]},
    {key:'list',title:'featureListTitle',checkbox:true}
  ]}
]);
const SELECTED=Object.freeze({filter:[],cultureTrace:['culture','trace'],staticsSearch:['statics','search']});

function SettingChoices({group,field,value,onChange,disabled,t}){
  const label=t(PATH+field.title);
  if(field.checkbox)return <fieldset className="scope-stat-controls"
    style={{border:0,margin:'.75rem 0',padding:0}}>
    <legend style={{fontWeight:600,marginBottom:'.3rem'}}>{label}</legend>
    <p className="scope-status">{t(PATH+'featureListVisibleHint')}</p>
    <label style={{display:'inline-flex',alignItems:'center',gap:'.4rem',cursor:disabled?'default':'pointer'}}>
      <input type="checkbox" checked={value===true} disabled={disabled}
        onChange={event=>onChange(group,field.key,event.target.checked)}/>
      {t(PATH+'featureListAdminAll')}
    </label>
  </fieldset>;
  return <fieldset className="scope-stat-controls" style={{border:0,margin:'.75rem 0',padding:0}}>
    <legend style={{fontWeight:600,marginBottom:'.3rem'}}>{label}</legend>
    <div role="group" aria-label={label} style={{display:'flex',flexWrap:'wrap',gap:'.45rem 1rem'}}>
      {field.options.map(([option,key])=><label key={option} style={{display:'inline-flex',alignItems:'center',gap:'.4rem',cursor:disabled?'default':'pointer'}}>
        <input type="radio" name={'loc-user-'+group+'-'+field.key} checked={value===option} disabled={disabled}
          onChange={()=>onChange(group,field.key,option)}/>{t(PATH+key)}
      </label>)}
    </div>
  </fieldset>;
}

export default function LocUserSettingsPanel({verifiedSubject='',section='filter'}){
  useUiSection('uiExtra.globalSettings');
  const t=useUiText();
  const {data,loading,error,ready,update}=useLocUser({verifiedSubject});
  const [draft,setDraft]=useState(null);
  const draftRef=useRef(null);
  const activeSubject=useRef('');
  const choiceVersion=useRef(0);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState('');
  const [saveError,setSaveError]=useState('');
  const [keywordClasses,setKeywordClasses]=useState([]);
  const [keywordError,setKeywordError]=useState('');

  useEffect(()=>{
    const subject=String(verifiedSubject||data?.userId||'');
    if(!subject||activeSubject.current===subject)return;
    const next={
      culture:{...LOC_USER_DEFAULTS.culture,...data.culture},
      statics:{...LOC_USER_DEFAULTS.statics,...data.statics},
      trace:{...LOC_USER_DEFAULTS.trace,...data.trace},
      search:{...LOC_USER_DEFAULTS.search,...data.search},
      keyword:data.keyword||'none'
    };
    activeSubject.current=subject;
    draftRef.current=next;
    setDraft(next);
    setStatus('');
    setSaveError('');
  },[data,verifiedSubject]);

  // Only the Filter section loads Keyword Class options. The other two tabs
  // never issue taxonomy requests simply because the user opened Settings.
  useEffect(()=>{
    if(section!=='filter'||!ready||!verifiedSubject)return undefined;
    let live=true;
    (async()=>{
      const {selectAvailableKeywordClasses}=await import('./keyword-analysis');
      const scopes=[['lo3rwang',t(PATH+'featureAuthor')],['lrunes',t(PATH+'featureRunes')]];
      const results=await Promise.allSettled(scopes.map(async([scope,label])=>{
        const result=await selectAvailableKeywordClasses(scope);
        return (result.classes||[])
          .filter(row=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(row.classUid||'')))
          .map(row=>({value:scope+':'+row.classUid,
            label:label+'／'+[row.categoryName,row.name].filter(Boolean).join('／')}));
      }));
      if(!live)return;
      const choices=new Map();
      for(const result of results){
        if(result.status==='fulfilled')for(const row of result.value)choices.set(row.value,row);
      }
      setKeywordClasses([...choices.values()].sort((a,b)=>a.label.localeCompare(b.label)));
      setKeywordError(results.every(result=>result.status==='rejected')
        ?t(PATH+'featureKeywordError'):'');
    })().catch(()=>{
      if(live)setKeywordError(t(PATH+'featureKeywordError'));
    });
    return()=>{live=false;};
  },[section,ready,verifiedSubject,t(PATH+'featureAuthor'),t(PATH+'featureRunes'),t(PATH+'featureKeywordError')]);

  const change=(group,key,value)=>{
    const current=draftRef.current;
    if(!current)return;
    const next={...current,[group]:group==='keyword'?value:{...current[group],[key]:value}};
    draftRef.current=next;
    setDraft(next);
    setSaving(true);
    setStatus('');
    setSaveError('');
    const uid=activeSubject.current,version=++choiceVersion.current;
    void update(group,next[group]).then(()=>{
      if(activeSubject.current!==uid||version!==choiceVersion.current)return;
      setSaving(false);setStatus(t(PATH+'featureSaved'));
    }).catch(reason=>{
      if(activeSubject.current!==uid||version!==choiceVersion.current)return;
      setSaving(false);
      setSaveError(t(PATH+'featureSaveError',{error:String(reason?.message||reason)}));
    });
  };

  if(loading||!ready||!draft)return <section className="loc-card" aria-label={t(PATH+'featureSettingsTitle')}>
    <h2>{t(PATH+'featureSettingsTitle')}</h2>
    <p role="status" className="scope-status">{error
      ?t(PATH+'featureLoadError',{error:String(error.message||error)})
      :t(PATH+'featureLoading')}</p>
  </section>;

  const storedClassIsMissing=draft.keyword!=='none'&&!keywordClasses.some(row=>row.value===draft.keyword);
  const visibleGroups=FIELDS.filter(group=>(SELECTED[section]||[]).includes(group.key));
  return <>
    {section==='filter'?<section className="loc-card">
      <h2>{t(PATH+'featureKeywordTitle')}</h2>
      <label className="scope-stat-controls">
        <span>{t(PATH+'featureKeywordGroup')}</span>
        <select className="scope-select" value={draft.keyword}
          onChange={event=>change('keyword','',event.target.value)}>
          <option value="none">{t(PATH+'featureKeywordNone')}</option>
          {keywordClasses.map(row=><option value={row.value} key={row.value}>{row.label}</option>)}
          {storedClassIsMissing?<option value={draft.keyword}>{t(PATH+'featureKeywordMissing')}</option>:null}
        </select>
      </label>
      {keywordError?<p role="status" className="scope-status scope-error">{keywordError}</p>:null}
    </section>:null}
    {visibleGroups.map(group=><section key={group.key} className="loc-card">
      <h2>{t(PATH+group.title)}</h2>
      {group.fields.map(field=><SettingChoices key={field.key}
        group={group.key} field={field} value={draft[group.key][field.key]}
        onChange={change} disabled={!ready} t={t}/>)}
    </section>)}
    <p role={saveError?'alert':'status'} className={'scope-status'+(saveError?' scope-error':'')}>
      {saveError||(saving?t(PATH+'featureSaving'):status||t(PATH+'featureSaveHint'))}
    </p>
    <p className="scope-status">{t(PATH+'featureAppliedHint')}</p>
  </>;
}
