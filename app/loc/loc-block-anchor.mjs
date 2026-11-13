// LOC presentation Blocks are a typed projection of silver.loc_anchor.
// Only LOC uses this mapping; other Scope _blocks tables remain independent.
// Anchor: uid / type / title / description / invisible / attr / createtime / num.
// Blocks: uid / page_name / block_title / block_text / false / metadata / now / block_order.
export const LOC_BLOCK_ANCHOR_FIELDS=Object.freeze([
  'uid','type','title','description','invisible','attr','num'
]);
const PAGE=/^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
const LOC_SOURCE_TYPES=new Set(['from','domain','galaxy','universe']);
export function isLocBlockPage(value){
  return typeof value==='string'&&PAGE.test(value)&&!LOC_SOURCE_TYPES.has(value);
}
function attrOf(row){
  const value=row?.attr;
  if(typeof value==='string')return JSON.parse(value);
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
export function locBlockToAnchor(row){
  if(!isLocBlockPage(row?.page_name))throw new TypeError('Invalid LOC Block page');
  const num=Number(row?.block_order);
  if(!Number.isSafeInteger(num)||num<1)throw new TypeError('Invalid LOC Block order');
  if(!/^[A-Za-z0-9]{8}$/.test(String(row?.uid||'')))
    throw new TypeError('Invalid LOC Block UID');
  const uidlist=row?.block_entity??[];
  if(!Array.isArray(uidlist)||uidlist.length>7)
    throw new TypeError('Invalid LOC Block entity list');
  return {
    uid:String(row.uid),type:row.page_name,
    title:String(row.block_title??''),description:String(row.block_text??''),
    invisible:false,num,
    attr:{
      uidlist,eyebrow:String(row.block_eyebrow??''),
      subtitle:String(row.block_subtitle??''),
      image:row.block_image==null?null:String(row.block_image)
    }
  };
}
export function locAnchorToBlock(row){
  const attr=attrOf(row);
  return {
    uid:String(row.uid??'').trim(),page_name:String(row.type??''),
    block_title:String(row.title??''),block_text:String(row.description??''),
    block_order:Number(row.num??0),block_entity:Array.isArray(attr.uidlist)?attr.uidlist:[],
    block_eyebrow:String(attr.eyebrow??''),
    block_subtitle:String(attr.subtitle??''),
    block_image:attr.image==null?null:String(attr.image)
  };
}
