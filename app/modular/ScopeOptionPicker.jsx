'use client';
import {useId,useMemo,useState} from 'react';

// Scope-managed time/space options are supplied by the existing authorized
// read path. Filter display labels only: never query or autocomplete UIDs.
const normalized=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();
const IDENTIFIER=/^[A-Za-z0-9]{8}$/;
const MAX_VISIBLE=200;

export default function ScopeOptionPicker({id,options=[],value='',onChange,
  disabled=false,allowClear=true,placeholder='選擇項目',noOptionsMessage='沒有符合項目'}){
  const generatedId=useId();
  const inputId=id||generatedId;
  const [input,setInput]=useState('');
  const term=normalized(input);
  const matches=useMemo(()=>
    IDENTIFIER.test(term)?[]:options.filter(option=>
      !term||normalized(option.label).includes(term)),[options,term]);
  const selected=options.find(option=>String(option.value)===String(value||''));
  const visible=matches.slice(0,MAX_VISIBLE);
  if(selected&&!visible.some(option=>option.value===selected.value))
    visible.unshift(selected);
  if(value&&!selected)
    visible.unshift({value,label:'原選項已失效'});
  return <div className="loc-scope-option-picker">
    <input id={inputId} type="search" autoComplete="off" value={input}
      disabled={disabled} placeholder={'篩選已授權'+placeholder}
      aria-label={'篩選'+placeholder}
      onChange={event=>setInput(event.target.value)}/>
    <select id={inputId+'-choice'} value={String(value||'')} disabled={disabled}
      aria-label={placeholder}
      onChange={event=>{onChange(event.target.value);setInput('');}}>
      <option value="" disabled={!allowClear}>{placeholder}</option>
      {visible.map(option=><option key={option.value} value={option.value}>
        {option.label}
      </option>)}
    </select>
    {term&&matches.length===0?<small className="scope-status">{noOptionsMessage}</small>:null}
    {matches.length>MAX_VISIBLE?<small className="scope-status">
      顯示前 {MAX_VISIBLE} 項，請縮小名稱範圍
    </small>:null}
  </div>;
}
