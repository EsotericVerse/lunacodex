'use client';

import ScopeEditableBlocks from './ScopeEditableBlocks';
import {AuthorHomeBlockDisplay,authorHomeBlockClass,homeBlockMediaStyle} from './LocHomeBlockDisplay';

// Author and LOC homepages share one block presentation contract. The Scope
// changes only content, ownership and pre-existing default artwork.
export default function AuthorHomeEditableBlocks(){
  return <ScopeEditableBlocks
    scopeId="lo3rwang"
    page="index"
    allowEditing
    explicitEditButton
    containerless
    maxBlocks={8}
    placeholderFirstOrder={1}
    headingLevel={2}
    renderDisplay={AuthorHomeBlockDisplay}
    resolveSlotClassName={authorHomeBlockClass}
    resolveSlotStyle={slot=>homeBlockMediaStyle(slot,'lo3rwang')}
    editSlotClassName="loc-card loc-home-block"
  />;
}
