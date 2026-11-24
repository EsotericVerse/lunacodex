'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {FIXED_MANAGE_ROWS} from '../../permissions/fixed-manage-registry.mjs';

export async function readGroupMembers(groupId){
  const group=String(groupId||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(group))throw Error('Invalid LOC Group');
  return withAuthorizedLocRead({scope:group},async db=>{
    const members=FIXED_MANAGE_ROWS.filter(row=>row.parent_scope_id===group&&
      row.manage_role==='scope'&&row.active===true);
    if(!members.length)return {data:[],count:null};
    const summaries=await db.selectFrom('silver.loc').select(['id','display_name'])
      .where('id','in',members.map(row=>row.id)).execute();
    const titles=new Map(summaries.map(row=>[row.id,row.display_name]));
    const rows=members.map(row=>({id:row.id,
      display_name:titles.get(row.id)||row.id,parent_scope_id:row.parent_scope_id,
      active:row.active,sort_order:row.sort_order}))
      .sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
    return {data:rows,count:null};
  });
}
