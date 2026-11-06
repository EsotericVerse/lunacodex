'use client';

import {useEffect,useRef,useState} from 'react';
import {scopeTagColumn,scopeTagNames} from './scope-config-fields.mjs';
import {useSWRConfig} from 'swr';
import {useScopeSourceCategoryRow} from './scope-source-category-row.mjs';
import {dbAuthRelation,dbAuthClient} from './db-client.mjs';
import {useAccount} from './use-account';
import {useUiLocale} from '../i18n/ui-locale';
import {useEditDock,useEditDockForm} from '../modular/edit-dock';

const LABELS={
  'zh-Hant':{work:'作品分類',personal:'個人分類',help:'每一項都是來源名稱字串，不設 ID、群組或目錄。',reading:'正在讀取',readError:'分類讀取失敗',notFound:'找不到 Scope 設定',noChanges:'沒有待儲存的修改。',invalid:'每個分類名稱須為 1–80 字。',duplicate:'分類名稱不能重複。',noPermission:'沒有寫入權限，分類未儲存。',saved:'已儲存。公開分類快照會於下次手動發布時同步。',denied:'沒有編輯權限。',retry:'重新讀取',item:'分類',remove:'刪除',add:'新增分類',save:'儲存',saving:'儲存中…',revert:'還原',moveUp:'上移一列',moveDown:'下移一列',moveBack:'往前',moveForward:'往後'},
  'zh-Hans':{work:'作品分类',personal:'个人分类',help:'每一项都是来源名称字符串，没有 ID、分组或目录。',reading:'正在读取',readError:'分类读取失败',notFound:'找不到 Scope 配置',noChanges:'没有待保存的修改。',invalid:'每个分类名称须为 1–80 字。',duplicate:'分类名称不能重复。',noPermission:'没有写入权限，分类未保存。',saved:'已保存。公开分类快照将在下次手动发布时同步。',denied:'没有编辑权限。',retry:'重新读取',item:'分类',remove:'删除',add:'新增分类',save:'保存',saving:'保存中…',revert:'还原',moveUp:'上移一行',moveDown:'下移一行',moveBack:'前移',moveForward:'后移'},
  en:{work:'Work categories',personal:'Personal categories',help:'Each entry is a literal source name. No IDs, groups or folders.',reading:'Loading',readError:'Failed to load categories',notFound:'Scope settings not found',noChanges:'No changes to save.',invalid:'Each name must contain 1–80 characters.',duplicate:'Category names must be unique.',noPermission:'Unable to save; check write permissions.',saved:'Saved. The public snapshot will update on the next manual publish.',denied:'You do not have permission to edit categories.',retry:'Retry',item:'Category',remove:'Remove',add:'Add category',save:'Save',saving:'Saving…',revert:'Revert',moveUp:'Move up one row',moveDown:'Move down one row',moveBack:'Move earlier',moveForward:'Move later'},
  ja:{work:'作品カテゴリー',personal:'個人カテゴリー',help:'各項目は出典名の文字列です。ID・グループ・階層はありません。',reading:'読み込み中',readError:'分類の読み込みに失敗しました',notFound:'Scope 設定がありません',noChanges:'未保存の変更はありません。',invalid:'分類名は 1～80 文字で入力してください。',duplicate:'分類名は重複できません。',noPermission:'書き込み権限がなく保存できません。',saved:'保存しました。公開情報は次回の手動公開時に反映されます。',denied:'編集権限がありません。',retry:'再読み込み',item:'分類',remove:'削除',add:'分類を追加',save:'保存',saving:'保存中…',revert:'元に戻す',moveUp:'上の行へ',moveDown:'下の行へ',moveBack:'前へ',moveForward:'後へ'}
};

// Each editable entry is a string; one text[] per Scope, without an item ID.
export default function FlatClassificationEditor({scopeId='loc'}){
  const account=useAccount();
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId===scopeId);
  const {locale}=useUiLocale();
  const l=LABELS[locale]||LABELS['zh-Hant'];
  const {mutate}=useSWRConfig();
  const global=scopeId==='loc';
  const valid=/^[a-z][a-z0-9]{0,14}$/.test(scopeId);
  const allowed=valid&&Boolean(account.user&&!account.loading&&!account.permissionLoading&&
    (global?account.canManageGroupSync('loc'):account.canManageScopeSync(scopeId)));
  const [draft,setDraft]=useState(null);
  const [gridColumns,setGridColumns]=useState(4);
  const listRef=useRef(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const row=useScopeSourceCategoryRow(scopeId,{enabled:allowed});
  // A Scope can view LOC-owned source names, but it cannot mutate their records.
  // Only the LOC management entry may save the system catalogue.
  const systemRow=useScopeSourceCategoryRow('loc',{enabled:allowed&&!global});
  const systemNames=systemRow.data?scopeTagNames('loc',systemRow.data):[];
  const query={
    ...row,
    data:row.data?scopeTagNames(scopeId,row.data):undefined,
    error:row.error||(allowed&&!row.isPending&&row.data===null?new Error(l.notFound):null)
  };
  const original=query.data||[];
  const rows=draft===null?original:draft;
  const changed=draft!==null&&JSON.stringify(draft)!==JSON.stringify(original);
  const title=global?l.work:l.personal;
  const change=(index,value)=>{setDraft(prev=>{
    const next=[...(prev===null?original:prev)];next[index]=value;return next;
  });setNotice('');};
  // Track the actual available panel width, not the whole device viewport.
  useEffect(()=>{
    const node=listRef.current;
    if(!node||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(([entry])=>{
      const width=entry.contentRect.width;
      setGridColumns(width<=420?1:width<=720?2:4);
    });
    observer.observe(node);
    return ()=>observer.disconnect();
  },[allowed,query.isPending,query.error]);
  const columns=()=>gridColumns;
  const move=(index,target)=>{
    if(target===index||target<0||target>=rows.length)return;
    setDraft(prev=>{
      const next=[...(prev===null?original:prev)];
      const [item]=next.splice(index,1);
      next.splice(target,0,item);
      return next;
    });
    setNotice('');
  };
  async function save(){
    if(!allowed||busy||query.isPending||query.error)return false;
    if(!changed){setNotice(l.noChanges);return true;}
    const names=rows.map(name=>String(name).trim());
    if(names.some(name=>!name||name.length>80)){setNotice(l.invalid);return false;}
    const normalized=names.map(name=>name.toLocaleLowerCase());
    if(new Set(normalized).size!==normalized.length){setNotice(l.duplicate);return false;}
    setBusy(true);setNotice('');
    try{
      if(global){
        const {data,error}=await dbAuthClient.schema('silver').managedAction('update_group_default_article_class',{
          p_group_id:'loc',p_names:names
        });
        if(error||data!==true)throw new Error(error?.message||l.noPermission);
      }else{
        const {data,error}=await dbAuthRelation('silver.'+scopeId).update({[scopeTagColumn(scopeId)]:names})
          .eq('id',scopeId).select('id');
        if(error||!data?.length)throw new Error(error?.message||l.noPermission);
      }
      await query.refetch();
      setDraft(null);
      await mutate(key=>Array.isArray(key)&&(
        ['scope-others-source-summary','own-scope-source-catalog','culture-source-classification','scope-overview','statistics-source-taxonomy'].includes(key[0])));
      setNotice(title+' '+l.saved);
      return true;
    }catch(error){setNotice(String(error?.message||error));return false;}
    finally{setBusy(false);}
  }
  useEditDockForm({save,isDirty:()=>changed,isBusy:()=>busy,
    discard:()=>{setDraft(null);setNotice('');}});
  if(!allowed)return <section className="loc-card scope-status scope-error" role="alert">{title}：{l.denied}</section>;
  return <section className="loc-card classification-inline">
    <h2>{title}</h2>
    {!global?<section className="scope-source-system-readonly" aria-label="系統來源分類（唯讀）">
      <h3>系統來源分類（唯讀）</h3>
      <p className="scope-status">由 LOC 統一管理；目前 Scope 只能查看，不能在此修改。</p>
      {systemRow.isPending?<p role="status">正在讀取系統來源…</p>:null}
      {systemRow.error?<p role="alert" className="scope-status scope-error">系統來源讀取失敗：{String(systemRow.error.message||systemRow.error)}</p>:null}
      {!systemRow.isPending&&!systemRow.error?<div className="classification-inline__list">{systemNames.map((name,index)=><span key={index} className="classification-inline__row">{name}</span>)}</div>:null}
    </section>:null}
    {query.isPending?<p role="status" className="scope-status">{l.reading} {title}…</p>:null}
    {query.error?<p role="alert" className="scope-status scope-error">{String(query.error.message||query.error)}
      <button type="button" className="loc-button" onClick={()=>query.refetch()}>{l.retry}</button>
    </p>:null}
    {!query.isPending&&!query.error?<form onSubmit={event=>{event.preventDefault();if(!inDock)void save();}}>
      <div className="classification-inline__list" ref={listRef}>
        {rows.map((name,index)=>{
          const up=index-columns();
          const down=Math.min(rows.length-1,index+columns());
          return <div className="classification-inline__row" key={index}>
            <label className="classification-inline__field">
              <span>{index+1}.</span>
              <input type="text" maxLength={80} required disabled={busy}
                aria-label={l.item+' '+(index+1)}
                value={name} onChange={event=>change(index,event.target.value)}/>
            </label>
            <div className="classification-inline__controls">
              <button type="button" disabled={busy||up<0} title={l.moveUp}
                aria-label={l.moveUp+' '+(index+1)} onClick={()=>move(index,up)}>↑</button>
              <button type="button" disabled={busy||index===rows.length-1} title={l.moveDown}
                aria-label={l.moveDown+' '+(index+1)} onClick={()=>move(index,down)}>↓</button>
              <button type="button" disabled={busy||index===0} title={l.moveBack}
                aria-label={l.moveBack+' '+(index+1)} onClick={()=>move(index,index-1)}>←</button>
              <button type="button" disabled={busy||index===rows.length-1} title={l.moveForward}
                aria-label={l.moveForward+' '+(index+1)} onClick={()=>move(index,index+1)}>→</button>
              <button type="button" className="classification-inline__remove" disabled={busy}
                title={l.remove} aria-label={l.remove+' '+(index+1)}
                onClick={()=>{setDraft(rows.filter((_,i)=>i!==index));setNotice('');}}>×</button>
            </div>
          </div>;
        })}
      </div>
      <div className="classification-inline__actions">
        <button type="button" className="loc-button" disabled={busy}
          onClick={()=>{setDraft([...rows,'']);setNotice('');}}>{l.add}</button>
        {!inDock?<button className="loc-button primary" type="submit" disabled={busy||!changed}>{busy?l.saving:l.save+' '+title}</button>:null}
      </div>
    </form>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
  </section>;
}
