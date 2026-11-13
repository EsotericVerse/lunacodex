// Class -> Group -> Item is a presentation model shared by the keyword library
// and Trace. Items retain their native identities and responsibilities.
// Trace Item: named saved map with an ordered anchor_list list; keyword Item:
// individual keyword row. No keyword analyzer runs for Trace.
export const normalizeClassificationText=value=>String(value??'').normalize('NFKC').trim();
export const classificationSearchKey=value=>normalizeClassificationText(value).toLocaleLowerCase('zh-Hant');

export function classGroupIndex(rows=[],{classOf,groupOf}={}){
  const index=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const group=normalizeClassificationText(groupOf?.(row));
    const cls=normalizeClassificationText(classOf?.(row));
    if(!index.has(cls))index.set(cls,new Map());
    const groups=index.get(cls);
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push(row);
  }
  return index;
}

// Optional parent layer for consumers with a top-level category.
// Reuse the same Class -> Group -> Item index without changing the keyword
// library's existing three-level data model.
export function categoryClassGroupIndex(rows=[],{categoryOf,classOf,groupOf}={}){
  const categories=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const category=normalizeClassificationText(categoryOf?.(row));
    if(!categories.has(category))categories.set(category,[]);
    categories.get(category).push(row);
  }
  return new Map([...categories].map(([category,items])=>[
    category,classGroupIndex(items,{classOf,groupOf})
  ]));
}
