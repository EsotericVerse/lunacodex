'use client';
import {lazy,Suspense} from 'react';
// Previously authored Scope Blocks retain their exact content. They now use
// the canonical trace page_name, never an alias or a second query.
const LazyScopeEditableBlocks=lazy(()=>import('../../loc/blocks/ScopeEditableBlocks'));
function ScopeEditableBlocks(props){return <Suspense fallback={null}><LazyScopeEditableBlocks {...props}/></Suspense>;}
export default function TraceBlocks({scopeId}){
  return <ScopeEditableBlocks scopeId={scopeId} page="trace"
    className={'loc-grid two trace-grid'+(scopeId==='loc'?' trace-grid-loc':'')}
    headingLevel={2} allowEditing={false} explicitEditButton/>;
}
