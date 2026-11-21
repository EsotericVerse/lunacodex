// One presentation component is used by every LOC Scope homepage.
// It renders only the SQL-provided rows, never the site navigation or dock.
import {HomeBlock} from './home-block-model.js';
import LocHomeBlockDisplay,{
  AuthorHomeBlockDisplay,RunesHomeBlockDisplay,
  locHomeBlockClass,authorHomeBlockClass,homeBlockMediaStyle
} from './LocHomeBlockDisplay.jsx';

const displays={loc:LocHomeBlockDisplay,lo3rwang:AuthorHomeBlockDisplay,
  lrunes:RunesHomeBlockDisplay};

export default function PublicHomeBlocks({scopeId,rows=[]}){
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
