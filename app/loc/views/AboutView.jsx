import ScopeEditableBlocks from '../blocks/ScopeEditableBlocks';
import LocHomeBlockDisplay,{locHomeBlockClass,homeBlockMediaStyle} from '../blocks/LocHomeBlockDisplay';

export default function AboutView(){
  return <section className="loc-view loc-home">
    <ScopeEditableBlocks
      scopeId="loc"
      page="index"
      headingLevel={2}
      allowEditing
      explicitEditButton
      containerless
      maxBlocks={8}
      placeholderFirstOrder={1}
      renderDisplay={LocHomeBlockDisplay}
      resolveSlotClassName={locHomeBlockClass}
      resolveSlotStyle={homeBlockMediaStyle}
      editSlotClassName="loc-card loc-home-block"
    />
  </section>;
}
