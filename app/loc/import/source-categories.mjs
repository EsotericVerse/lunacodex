// Source choices are optional while Auth and the published SiteLucus
// snapshot load. Keep a stable shape so the import panel can render immediately.
export function importSourceCategories(enabled,resource){
  if(!enabled||!Array.isArray(resource?.categories))
    return {system:[],personal:[]};
  const system=[...new Set(resource.categories)];
  if(system.length)system.push('Others');
  return {system,personal:[]};
}
