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
const SELECTED=Object.freeze({filter:[],cultureTrace:['culture','trace'],staticsSearch:['statics','search'],
  dashboard:['culture','statics','trace','search']});

function SettingChoices({group,field,value,onChange,disabled,t}){
  const options=field.checkbox
    ?[['false','featureListVisibleHint'],['true','featureListAdminAll']]
    :field.options;
  return <label className="loc-user-setting-field">
    <span>{t(PATH+field.title)}</span>
    <select className="scope-select" disabled={disabled}
      value={field.checkbox?String(value===true):String(value??'')}
      onChange={event=>onChange(group,field.key,
        field.checkbox?event.target.value==='true':event.target.value)}>
      {options.map(([option,key])=><option value={option} key={option}>
        {t(PATH+key)}
      </option>)}
    </select>
  </label>;
}

export default function LocUserSettingsPanel({verifiedSubject='',section='filter',filterSection=null}){
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
    // The verified Session may arrive before its owner-scoped preferences.
    // Never dereference an unloaded row or freeze the draft at that point.
    if(!ready||!data)return;
    const subject=String(verifiedSubject||data.owner_id||'');
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
  },[data,verifiedSubject,ready]);

  // Only the Filter section loads Keyword Class options. The other two tabs
  // never issue taxonomy requests simply because the user opened Settings.
  useEffect(()=>{
    if(!['filter','dashboard'].includes(section)||!ready||!verifiedSubject)return undefined;
    let live=true;
    (async()=>{
      const {selectAvailableKeywordClasses}=await import('./keywords/analysis');
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
  if(section==='dashboard')visibleGroups.sort((a,b)=>
    SELECTED.dashboard.indexOf(a.key)-SELECTED.dashboard.indexOf(b.key));
  return <>
    {['filter','dashboard'].includes(section)?<section
      className={'loc-card'+(section==='dashboard'?' scope-settings-dashboard__filter':'')}>
      {section==='dashboard'?<h2>{t(PATH+'featureFilter')}</h2>:<h2>{t(PATH+'featureKeywordTitle')}</h2>}
      {section==='dashboard'?filterSection:null}
      {section==='dashboard'?<h3>{t(PATH+'featureKeywordTitle')}</h3>:null}
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
    <p role={saveError?'alert':'status'} className={'scope-status'+(section==='dashboard'?' scope-settings-dashboard__footer':'')+(saveError?' scope-error':'')}>
      {saveError||(saving?t(PATH+'featureSaving'):status||t(PATH+'featureSaveHint'))}
    </p>
    <p className={'scope-status'+(section==='dashboard'?' scope-settings-dashboard__footer':'')}>{t(PATH+'featureAppliedHint')}</p>
  </>;
}
