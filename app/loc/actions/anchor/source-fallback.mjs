'use server';
import {withPublicLocRead} from '../read-context.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../../packages/zenstack/anchor-hierarchy.mjs';

// Fixed recovery query for the public SiteAnchor catalogue. It is used only
// when its published Asset is disabled or cannot be loaded; callers cannot
// supply a table, filter, or SQL statement.
export async function readPublicSourceAnchorsFromSql(){
  return withPublicLocRead({scope:'loc'},async db=>{
    const rows=await db.selectFrom('silver.loc_anchor')
      .select(['uid','type','title','description','attr','invisible'])
      .where('type','in',ANCHOR_TYPE_GROUPS.source)
      .where('invisible','=',false)
      .orderBy('uid','asc').execute();
    if(!Array.isArray(rows)||!rows.length)
      throw new Error('LOC 文章來源資料尚未發佈。');
    return rows;
  });
}
