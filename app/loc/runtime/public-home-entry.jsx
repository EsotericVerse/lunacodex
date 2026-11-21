// Home data begins only after the static HTML, navigation, footer and dock exist.
// All three homepages use the same one-request page read and display component.
import {createRoot} from 'react-dom/client';
// One presentation component is used by every LOC Scope homepage.
// It renders only the SQL-provided rows, never the site navigation or dock.
import {HomeBlock} from '../blocks/home-block-model.js';
import LocHomeBlockDisplay,{
  AuthorHomeBlockDisplay,RunesHomeBlockDisplay,
  locHomeBlockClass,authorHomeBlockClass,homeBlockMediaStyle
} from '../blocks/LocHomeBlockDisplay.jsx';

const displays={loc:LocHomeBlockDisplay,lo3rwang:AuthorHomeBlockDisplay,
  lrunes:RunesHomeBlockDisplay};

function PublicHomeBlocks({scopeId,rows=[]}){
  const View=displays[scopeId];
  if(!View)return null;
  return <section className="loc-view loc-home">
    {HomeBlock.rows(rows,'index',HomeBlock.limit).map(row=>{
      const slot=HomeBlock.normalizeRow(row,row.block_order,'index');
      const className=scopeId==='lo3rwang'?authorHomeBlockClass(slot)
        :locHomeBlockClass(slot,scopeId);
      const style=homeBlockMediaStyle(slot,scopeId);
      return <section className={className+' scope-editable-block'}
        data-page-name="index" data-block-order={slot.order}
        key={slot.uid||slot.order} style={style}>
        <View {...slot}/>
      </section>;
    })}
  </section>;
}


const scope=document.body.dataset.locScope||'';
const slot=document.getElementById('loc-home-sql-slot');
if(slot&&['loc','lo3rwang','lrunes'].includes(scope)){
  const controller=new AbortController();
  const root=createRoot(slot);
  let disposed=false;
  window.__locHomeUnmount=()=>{
    if(disposed)return;
    disposed=true;
    controller.abort();
    root.unmount();
    delete window.__locHomeUnmount;
  };
  (async()=>{
    try{
      // A single fixed, public Kysely read obtains every Block for index.
      // The API chooses the relation: callers cannot supply SQL or table names.
      const response=await fetch('/api/loc-public-content?'+
        new URLSearchParams({kind:'block_list',scope}),{
        method:'GET',cache:'no-store',credentials:'omit',
        headers:{accept:'application/json'},signal:controller.signal
      });
      if(!response.ok)throw new Error('首頁資料讀取失敗（HTTP '+response.status+'）');
      const payload=await response.json();
      if(disposed)return;
      const rows=Array.isArray(payload.data)?payload.data:[];
      root.render(<PublicHomeBlocks scopeId={scope}
        rows={rows.filter(row=>row?.page_name==='index')}/>);
    }catch(error){
      if(disposed||controller.signal.aborted)return;
      slot.replaceChildren();
      const message=document.createElement('p');
      message.className='scope-status scope-error';
      message.setAttribute('role','status');
      message.textContent=String(error?.message||'首頁資料讀取失敗');
      slot.appendChild(message);
    }
  })();
  window.addEventListener('pagehide',()=>window.__locHomeUnmount?.(),{once:true});
}
