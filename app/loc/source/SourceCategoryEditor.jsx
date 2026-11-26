'use client';
import {lazy,Suspense} from 'react';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {useAsyncResource} from '../../../packages/zenstack/client-queries';
import {readPublicSourceAnchors} from './catalog-public.mjs';
import {sourceEditorOutlineGroups} from './outline-options.mjs';

const LazyKeywordNetworkEditor=lazy(()=>import('../keywords/ui/KeywordNetworkEditor'));
function KeywordNetworkEditor(props){return <Suspense fallback={null}><LazyKeywordNetworkEditor {...props}/></Suspense>;}
const EMPTY_COUNTS={lo3rwang:0,lrunes:0};
const normalized=rows=>(rows||[]).map(row=>{
  const raw=typeof row.attr==='string'?(()=>{
    try{return JSON.parse(row.attr);}catch{return {};}
  })():row.attr;
  const attr=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const counts=attr.counts&&typeof attr.counts==='object'&&!Array.isArray(attr.counts)
    ?attr.counts:{};
  return {...row,attr:{...attr,uid:Array.isArray(attr.uid)?attr.uid:[],
    counts:{...EMPTY_COUNTS,...counts}}};
});
async function fetchSources(){return normalized(await readPublicSourceAnchors());}

export function useSourceCategories(){
  return useAsyncResource(['loc-source-anchor'],async()=>{
    const nodes=await fetchSources();
    return {categories:nodes.filter(row=>row.type==='from').map(row=>row.title),
      aliases:[],groups:[],nodes};
  });
}

// The LOC SiteAnchor hierarchy is fixed public taxonomy. This panel shows the
// same published JavaScript snapshot used by Culture, Statistics, Search and
// Import; it has no live SQL controls that could diverge from the release copy.
export function AdminSourceCategories(){
  const [nodes,setNodes]=useState([]);
  const [selected,setSelected]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const byUid=useMemo(()=>new Map(nodes.map(row=>[row.uid,row])),[nodes]);
  const current=byUid.get(selected)||null;
  const sourceGroups=useMemo(()=>sourceEditorOutlineGroups(nodes),[nodes]);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const found=await fetchSources();setNodes(found);
      setSelected(uid=>found.some(row=>row.uid===uid)?uid:'');
    }catch(e){setError(String(e.message||e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  return <section className="loc-card scope-feature-card scope-keyword-management">
    <h2>文章來源</h2>
    <p className="scope-status">LOC 固定來源階層；此處顯示已發布資料。</p>
    {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
    {loading?<p className="scope-status" role="status">讀取來源階層中…</p>:null}
    {!loading&&!error?<div className="scope-keyword-network-layout">
      <KeywordNetworkEditor sourceNodes={nodes} selectedId={selected}
        className="LOC 文章來源" classId="loc-sources" readOnly
        onSelectNode={node=>setSelected(node.uid)}/>
      <aside className="scope-keyword-network-inspector" aria-label="LOC 來源階層">
        <div className="scope-management-fields">
          <label><span>來源階層</span>
            <select className="scope-select" value={selected} onChange={event=>setSelected(event.target.value)}>
              <option value="">選擇來源</option>
              {sourceGroups.map(group=><optgroup key={group.key} label={group.label}>
                {group.items.map(row=><option key={row.code} value={row.code}>
                  {'　'.repeat(row.orphanType?Math.max(0,row.level-
                    ['universe','galaxy','domain','from'].indexOf(row.orphanType)):row.level)}{row.label}
                </option>)}
              </optgroup>)}
            </select>
          </label>
        </div>
        {current?<details className="scope-source-meta" open>
          <summary>來源資料</summary>
          <p className="scope-status">UID：<code>{current.uid}</code> · {current.type}
            {' · '}lo3rwang：{Number(current.attr.counts.lo3rwang||0).toLocaleString()}
            {' · '}lrunes：{Number(current.attr.counts.lrunes||0).toLocaleString()}</p>
        </details>:null}
      </aside>
    </div>:null}
  </section>;
}
