'use client';
import dynamic from 'next/dynamic';
// Previously authored Scope Blocks retain their exact content. They now use
// the canonical trace page_name, never an alias or a second query.
const ScopeEditableBlocks=dynamic(()=>import('../../loc/blocks/ScopeEditableBlocks'),{loading:()=>null});
export default function TraceBlocks({scopeId}){
  return <ScopeEditableBlocks scopeId={scopeId} page="trace"
    className={'loc-grid two trace-grid'+(scopeId==='loc'?' trace-grid-loc':'')}
    headingLevel={2} allowEditing={false} explicitEditButton/>;
}
