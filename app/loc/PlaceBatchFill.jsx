'use client';

import {useMemo,useRef,useState} from 'react';
import {useEditDockForm} from '../modular/edit-dock';
import {dbAuthClient} from './db-client.mjs';
import {defaultScopeData,revalidateServerMetadata} from './scope-data';
import {selectCultureTimeRows} from './culture-query';
import {useAsyncResource,useResourceCache} from '../../zenstack/client-queries';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
function validDate(value){
  if(!DATE.test(value))return false;
  const d=new Date(value+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function verified(result){
  if(result.error)throw new Error(result.error.message||'資料庫操作失敗');
  return result.data;
}
function sampleRows(preview){
  const rows=[...(preview?.first||[]),...(preview?.last||[]).slice().reverse()];
  const seen=new Set();
  return rows.filter(row=>{
    if(seen.has(row.uid))return false;
    seen.add(row.uid);return true;
  }).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
export default function PlaceBatchFill({scopeId,anchors=[]}){
  const cache=useResourceCache();
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [place,setPlace]=useState('');
  const [periodId,setPeriodId]=useState('');
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const revision=useRef(0);
  const scope=useMemo(()=>defaultScopeData(scopeId),[scopeId]);
  const suggestions=useAsyncResource(['place-batch-suggestions',scopeId],async()=>{
    const result=await dbAuthClient.schema('silver').anchor(scopeId,'point',{op:'suggestions',limit:60});
    return verified(result)||[];
  },{revalidateOnFocus:false,revalidateOnReconnect:false});
  const periods=useAsyncResource(['place-batch-time',scopeId],
    ()=>selectCultureTimeRows(scope),{enabled:Boolean(scope?.time),revalidateOnFocus:false,revalidateOnReconnect:false});
  const choices=(periods.data||[]).filter(row=>['period','event'].includes(row.entry_type)&&validDate(String(row.start_date||'')));
  const locations=[...new Set([
    ...anchors.filter(row=>row.source_scope===scopeId).map(row=>String(row.title||'').trim()),
    ...(suggestions.data||[]).map(row=>String(row.name||'').trim())
  ].filter(Boolean))];
  const isValid=validDate(startDate)&&validDate(endDate)&&startDate<=endDate&&
    place.trim().length>0&&place.trim().length<=200;
  const criteria=[scopeId,startDate,endDate,place.trim()].join('|');
  const currentPreview=preview?.criteria===criteria?preview.data:null;
  const count=Number(currentPreview?.count||0);
  const sample=sampleRows(currentPreview);
  const omitted=Math.max(0,count-sample.length);
  const change=(field,value)=>{
    revision.current++;
    setPreview(null);setNotice('');
    field(value);
  };
  function usePeriod(id){
    const period=choices.find(row=>row.entry_key===id);
    revision.current++;setPreview(null);setNotice('');
    setPeriodId(id);
    setStartDate(validDate(String(period?.start_date||''))?String(period.start_date):'');
    setEndDate(validDate(String(period?.end_date||''))?String(period.end_date):'');
  }
  async function inspect(){
    if(!isValid||busy)return;
    const token=++revision.current;
    setBusy(true);setNotice('');setPreview(null);
    try{
      const response=await dbAuthClient.schema('silver').managedAction('preview_or_fill_galaxy_place',{
        p_scope_id:scopeId,p_start_date:startDate,p_end_date:endDate,p_place:place.trim(),
        p_apply:false
      });
      const data=verified(response);
      if(token===revision.current)setPreview({criteria,data});
    }catch(error){
      if(token===revision.current)setNotice('預覽失敗：'+String(error.message||error));
    }finally{setBusy(false);}
  }
  async function apply(){
    if(!isValid||busy||!currentPreview||count===0){
      setNotice('請先預覽符合條件的文章，再使用底部儲存。');return false;
    }
    const confirmed=window.confirm('確認把 '+count+' 篇原本沒有打卡地點的文章補成「'+place.trim()+'」？\n\n'+startDate+' ～ '+endDate+'\n原有非空白地點不會覆蓋。');
    if(!confirmed)return false;
    const token=++revision.current;
    setBusy(true);setNotice('');
    try{
      const result=await dbAuthClient.schema('silver').managedAction('preview_or_fill_galaxy_place',{
        p_scope_id:scopeId,p_start_date:startDate,p_end_date:endDate,p_place:place.trim(),
        p_apply:true,p_expected_count:count
      });
      const data=verified(result);
      await revalidateServerMetadata();
      await cache.invalidate({queryKey:['loc-place-summary',scopeId]});
      if(token===revision.current){
        setPreview(null);
        setNotice('已補寫 '+Number(data?.count||0)+' 篇文章的 location；原本已有地點的文章沒有修改。');
        await suggestions.mutate();
      }
      return true;
    }catch(error){
      if(token===revision.current){
        setPreview(null);
        setNotice('寫入未完成，請重新預覽：'+String(error.message||error));
      }
      return false;
    }finally{setBusy(false);}
  }
  useEditDockForm({save:apply,isDirty:()=>Boolean(currentPreview&&count>0),isBusy:()=>busy});
  return <section className="loc-card scope-feature-card">
    <h3>快速補寫打卡地點</h3>
    <div className="scope-management-fields">
      <label>從現有時期／事件帶入（可選）
        <select className="scope-select" value={periodId} disabled={busy||periods.isPending} onChange={event=>usePeriod(event.target.value)}>
          <option value="">自行指定完整日期</option>
          {choices.map(row=><option key={row.entry_key} value={row.entry_key}>
            {row.title} · {row.start_date}{validDate(String(row.end_date||''))?' ～ '+row.end_date:'（請填結束日期）'}
          </option>)}
        </select>
      </label>
      <label>起始日期（年／月／日）
        <input type="date" value={startDate} disabled={busy} onChange={event=>change(setStartDate,event.target.value)}/>
      </label>
      <label>結束日期（年／月／日）
        <input type="date" value={endDate} disabled={busy} onChange={event=>change(setEndDate,event.target.value)}/>
      </label>
      <label>補寫的打卡地點名稱
        <input type="text" list={'place-batch-'+scopeId} maxLength={200} value={place} disabled={busy}
          placeholder="輸入既有 Facebook 打卡名稱或空間定錨點名稱"
          onChange={event=>change(setPlace,event.target.value)}/>
        <datalist id={'place-batch-'+scopeId}>
          {locations.map(name=><option key={name} value={name}/>)}
        </datalist>
      </label>
    </div>
    {Boolean(suggestions.data?.length)?<p className="scope-status">
      常見打卡：{suggestions.data.slice(0,8).map(row=><button type="button" key={row.name}
        className="loc-button" disabled={busy} onClick={()=>change(setPlace,row.name)}>
        {row.name}（{row.article_count}）
      </button>)}
    </p>:null}
    {periods.error?<p className="scope-status scope-error">時期讀取失敗：{String(periods.error.message||periods.error)}</p>:null}
    {suggestions.error?<p className="scope-status scope-error">常用地點讀取失敗：{String(suggestions.error.message||suggestions.error)}</p>:null}
    <div className="scope-stat-controls">
      <button type="button" className="loc-button" onClick={inspect} disabled={!isValid||busy}>
        {busy?'處理中…':'預覽符合條件的文章'}
      </button>

    </div>
    {currentPreview?<section className="scope-card" aria-label="快速補寫預覽">
      <h4>預計補寫 {count.toLocaleString()} 篇</h4>
      {count===0?<p className="scope-status">此日期範圍內，沒有尚未填寫地點的文章。</p>:<>
        <ul>
          {sample.map((row,index)=><li key={row.uid}>
            {row.date} · {row.title||'未命名文章'}（{row.uid}）
            {index===2&&omitted>0?<p className="scope-status">中間省略 {omitted.toLocaleString()} 篇</p>:null}
          </li>)}
        </ul>
        <p className="scope-status">請確認預覽內容，使用底部「儲存」補寫 {count.toLocaleString()} 篇文章。</p>
      </>}
    </section>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}
