'use client';
import {useEffect,useRef,useState} from 'react';
import useLocUser from './use-loc-user';
import {LOC_USER_DEFAULTS} from './loc-user-store.mjs';

const GROUPS=Object.freeze([
  {key:'culture',title:'文化設定',fields:[
    {key:'time',title:'首頁時間顯示',options:[['anchor','定錨點'],['period','期間'],['era','時代（預設）']]},
    {key:'display',title:'首頁顯示',options:[['density','文章密度（預設）'],['keywords','關鍵詞']]},
    {key:'unit',title:'時間單位顯示',options:[['day','日（預設）'],['week','週'],['month','月'],['year','年']]},
    {key:'sort',title:'文章排列',options:[['desc','最新的優先（預設）'],['asc','最舊的優先']]}
  ]},
  {key:'statics',title:'統計設定',fields:[
    {key:'display',title:'首頁統計顯示',options:[['source','來源（預設）'],['media_type','多媒體']]},
    {key:'unit',title:'時間單位顯示',options:[['day','日（預設）'],['week','週'],['month','月'],['year','年']]},
    {key:'sort',title:'文章排列',options:[['desc','最新的優先（預設）'],['asc','最舊的優先']]}
  ]},
  {key:'trace',title:'痕跡設定',fields:[
    {key:'display',title:'首頁空間顯示',options:[['anchor','定錨點（預設）'],['path','路線圖'],['trace','痕跡圖']]},
    {key:'time',title:'時間單位顯示',options:[['none','無（預設）'],['period','期間'],['era','時代']]},
    {key:'sort',title:'文章排列',options:[['desc','最新的優先（預設）'],['nearest','最近的優先']]}
  ]},
  {key:'search',title:'搜尋設定',fields:[
    {key:'field',title:'搜尋方式',options:[['content','文章內容（預設）'],['title','標題文字']]},
    {key:'sort',title:'文章排列',options:[['asc','最舊的優先（預設）'],['desc','最新的優先']]}
  ]}
]);

function SettingChoices({group,field,value,onChange,disabled}){
  const name='loc-user-'+group+'-'+field.key;
  return <fieldset className="scope-stat-controls" style={{border:0,margin:'.75rem 0',padding:0}}>
    <legend style={{fontWeight:600,marginBottom:'.3rem'}}>{field.title}</legend>
    <div role="group" aria-label={field.title} style={{display:'flex',flexWrap:'wrap',gap:'.45rem 1rem'}}>
      {field.options.map(([option,label])=><label key={option} style={{display:'inline-flex',alignItems:'center',gap:'.4rem',cursor:disabled?'default':'pointer'}}>
        <input type="radio" name={name} checked={value===option} disabled={disabled}
          onChange={()=>onChange(group,field.key,option)}/>{label}
      </label>)}
    </div>
  </fieldset>;
}

export default function LocUserSettingsPanel({verifiedSubject=''}){
  const {data,loading,error,ready,update}=useLocUser({verifiedSubject});
  const [draft,setDraft]=useState(null);
  const draftRef=useRef(null);
  const activeUid=useRef('');
  const choiceVersion=useRef(0);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState('');
  const [saveError,setSaveError]=useState('');
  const [keywordClasses,setKeywordClasses]=useState([]);
  const [keywordError,setKeywordError]=useState('');

  // A user switch resets the controls, but SWR mutations for the same user
  // must not overwrite a newer in-progress radio choice.
  useEffect(()=>{
    const uid=String(data?.uid||'');
    if(!uid||activeUid.current===uid)return;
    const next={
      culture:{...LOC_USER_DEFAULTS.culture,...data.culture},
      statics:{...LOC_USER_DEFAULTS.statics,...data.statics},
      trace:{...LOC_USER_DEFAULTS.trace,...data.trace},
      search:{...LOC_USER_DEFAULTS.search,...data.search},
      keyword:data.keyword||'none'
    };
    activeUid.current=uid;
    draftRef.current=next;
    setDraft(next);
    setStatus('');
    setSaveError('');
  },[data]);

  // Only open this component after the OAuth Settings account is verified.
  // Read published/authorized Keyword Class choices, never entire Keyword trees.
  useEffect(()=>{
    if(!ready||!data?.uid)return undefined;
    let live=true;
    (async()=>{
      const {selectAvailableKeywordClasses}=await import('./keyword-analysis');
      const scopes=[['lo3rwang','作者作品'],['lrunes','月之符文']];
      const results=await Promise.allSettled(scopes.map(async([scope,label])=>{
        const result=await selectAvailableKeywordClasses(scope);
        return (result.classes||[])
          .filter(row=>/^(?:[A-Za-z0-9]{4}|[A-Za-z0-9]{8})$/.test(String(row.classUid||'')))
          .map(row=>({
            value:scope+':'+row.classUid,
            label:label+'／'+[row.categoryName,row.name].filter(Boolean).join('／')
          }));
      }));
      if(!live)return;
      const choices=new Map();
      for(const result of results){
        if(result.status==='fulfilled')for(const row of result.value)choices.set(row.value,row);
      }
      setKeywordClasses([...choices.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-Hant')));
      if(results.every(result=>result.status==='rejected'))
        setKeywordError('關鍵詞群組暫時無法讀取；不影響其他設定。');
      else setKeywordError('');
    })().catch(()=>{
      if(live)setKeywordError('關鍵詞群組暫時無法讀取；不影響其他設定。');
    });
    return()=>{live=false;};
  },[ready,data?.uid]);

  const change=(group,key,value)=>{
    const current=draftRef.current;
    if(!current)return;
    const next={...current,[group]:group==='keyword'?value:{...current[group],[key]:value}};
    draftRef.current=next;
    setDraft(next);
    setSaving(true);
    setStatus('');
    setSaveError('');
    const uid=activeUid.current,version=++choiceVersion.current;
    void update(group,next[group]).then(()=>{
      if(activeUid.current!==uid||version!==choiceVersion.current)return;
      setSaving(false);setStatus('已儲存');
    }).catch(reason=>{
      if(activeUid.current!==uid||version!==choiceVersion.current)return;
      setSaving(false);
      setSaveError('儲存失敗：'+String(reason?.message||reason));
    });
  };

  if(loading||!ready||!draft)return <section className="loc-card" aria-label="個人功能設定">
    <h2>濾鏡設定與功能設定</h2>
    <p role="status" className="scope-status">{error?'個人設定讀取失敗：'+String(error.message||error):'正在讀取 OAuth 個人設定…'}</p>
  </section>;
  const storedClassIsMissing=draft.keyword!=='none'&&!keywordClasses.some(row=>row.value===draft.keyword);
  return <>
    <section className="loc-card">
      <h2>濾鏡設定</h2>
      <label className="scope-stat-controls">
        <span>關鍵詞群組設定</span>
        <select className="scope-select" value={draft.keyword}
          onChange={event=>change('keyword','',event.target.value)}>
          <option value="none">無（預設）</option>
          {keywordClasses.map(row=><option value={row.value} key={row.value}>{row.label}</option>)}
          {storedClassIsMissing?<option value={draft.keyword}>已儲存的群組（目前未公開或未載入）</option>:null}
        </select>
      </label>
      {keywordError?<p role="status" className="scope-status scope-error">{keywordError}</p>:null}
    </section>
    <h2>功能設定</h2>
    {GROUPS.map(group=><section key={group.key} className="loc-card">
      <h3>{group.title}</h3>
      {group.fields.map(field=><SettingChoices key={field.key}
        group={group.key} field={field} value={draft[group.key][field.key]}
        onChange={change} disabled={!ready}/>)}
    </section>)}
    <p role={saveError?'alert':'status'} className={'scope-status'+(saveError?' scope-error':'')}>
      {saveError|| (saving?'正在儲存…':status||'選取後立即儲存至個人帳號。')}
    </p>
    <p className="scope-status">已儲存的個人選項會直接套用至文化、統計、痕跡及搜尋頁；訪客維持公開預設。</p>
  </>;
}
