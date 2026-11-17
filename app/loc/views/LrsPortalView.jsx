import ScopeEditableBlocks from '../blocks/ScopeEditableBlocks';
import {RunesHomeBlockDisplay,locHomeBlockClass,homeBlockMediaStyle} from '../blocks/LocHomeBlockDisplay';

// lrunes is an ordinary LOC Scope. LRS owns the Rune engines and media,
// never this Scope's homepage, Blocks, edit controls, or access policy.
export default function LrsPortalView(){
  return <section className="loc-view loc-home">
    <ScopeEditableBlocks
      scopeId="lrunes"
      page="index"
      headingLevel={2}
      allowEditing
      explicitEditButton
      containerless
      maxBlocks={8}
      placeholderFirstOrder={1}
      renderDisplay={RunesHomeBlockDisplay}
      resolveSlotClassName={slot=>locHomeBlockClass(slot,'lrunes')}
      resolveSlotStyle={slot=>homeBlockMediaStyle(slot,'lrunes')}
      editSlotClassName="loc-card loc-home-block"
    />
  </section>;
}
