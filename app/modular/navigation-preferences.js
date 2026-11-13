// Navigation preferences are individual values in silver.loc_user.user_setting JSONB.
export const HOME_SETTING_KEY='loc-home-scope-v1';
export const FAVORITES_SETTING_KEY='loc-favorite-scopes-v1';
export const DEFAULT_FAVORITES=Object.freeze(['lrunes','lo3rwang','loc']);
const VALID_SCOPE=/^[a-z][a-z0-9]{0,14}$/;
export function validScopeId(value){const id=String(value||'').trim().toLowerCase();return VALID_SCOPE.test(id)?id:'';}
export function parseFavorites(raw){
  if(raw===null||raw===undefined)return [...DEFAULT_FAVORITES];
  return [...new Set(String(raw).split(',').map(validScopeId).filter(id=>id&&id!=='admin'))];
}
export function serializeFavorites(values){
  return [...new Set((Array.isArray(values)?values:[]).map(validScopeId).filter(id=>id&&id!=='admin'))].join(',');
}
export function homeScopeForAccount(value,account,allowedScopeIds=[]){
  const id=validScopeId(value);
  if(!account?.user||id==='loc'||!id)return 'loc';
  const allowed=new Set(allowedScopeIds.map(validScopeId));
  // Choosing a PUBLIC homepage is navigation, not Scope management.
  return allowed.has(id)?id:'loc';
}

// Per-device setting only: never a cloud Scope or silver.loc_user setting.
export const MOBILE_HOME_ID='myphone';
export const MOBILE_FAVORITE_STORAGE_KEY='loc-device-myphone-favorite-v1';
export const MOBILE_HOME_STORAGE_KEY='loc-device-home-v1';
export function mobileFavoriteEnabled(storage){
  try{return storage?.getItem(MOBILE_FAVORITE_STORAGE_KEY)!=='false';}
  catch{return true;}
}
export function mobileHomepageChoice(storage){
  try{
    const saved=storage?.getItem(MOBILE_HOME_STORAGE_KEY);
    return typeof saved==='string'&&/^[a-z0-9_-]{1,64}$/i.test(saved)?saved:'loc';
  }catch{return 'loc';}
}
export function mobileHomepageEnabled(storage){
  return mobileHomepageChoice(storage)===MOBILE_HOME_ID;
}
export function mobileHomeHref(native){return native?'/my-phone/index.html':'/';}
export function isMobileHome(id){return String(id)===MOBILE_HOME_ID;}

// Favorite folders are a presentation layer, not Scope Groups or permissions.
// Stored as one string value in silver.loc_user.user_setting (encoded tab-separated rows).
export const FOLDERS_SETTING_KEY='loc-favorite-folders-v1';
export const MAX_FOLDERS=30;
const ID=/^[a-z][a-z0-9]{3,35}$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
export function cleanFolderName(value){return String(value||'').trim().replace(/[\r\n\t]+/g,' ').slice(0,35);}
export function normalizeFavoriteFolders(rows=[]){
  const seenFolders=new Set(),assigned=new Set(),out=[];
  for(const raw of Array.isArray(rows)?rows:[]){
    const id=String(raw?.id||'').trim().toLowerCase();
    const label=cleanFolderName(raw?.label);
    if(!ID.test(id)||!label||seenFolders.has(id))continue;
    const scopes=[];
    for(const item of Array.isArray(raw?.scopes)?raw.scopes:[]){
      const sid=String(item||'').trim().toLowerCase();
      if(!SCOPE.test(sid)||sid==='admin'||sid==='loc'||assigned.has(sid))continue;
      assigned.add(sid);scopes.push(sid);
    }
    seenFolders.add(id);out.push({id,label,scopes});
    if(out.length>=MAX_FOLDERS)break;
  }
  return out;
}
export function serializeFavoriteFolders(rows=[]){
  return normalizeFavoriteFolders(rows).map(({id,label,scopes})=>
    id+'\t'+encodeURIComponent(label)+'\t'+scopes.join(',')
  ).join('\n');
}
export function parseFavoriteFolders(raw){
  if(!raw)return [];
  const entries=String(raw).split('\n').slice(0,MAX_FOLDERS*2).map(line=>{
    const [id,encoded='',scopes='']=line.split('\t');
    let label='';
    try{label=decodeURIComponent(encoded);}catch{return null;}
    return {id,label,scopes:scopes.split(',').filter(Boolean)};
  }).filter(Boolean);
  return normalizeFavoriteFolders(entries);
}
export function visibleFavoriteLayout(favorites=[],folders=[]){
  const ids=[...new Set(favorites)].filter(id=>id!=='loc'&&id!=='admin');
  const available=new Set(ids);
  const owned=new Set();
  const directories=normalizeFavoriteFolders(folders).map(folder=>{
    const scopes=folder.scopes.filter(id=>available.has(id)&&!owned.has(id));
    scopes.forEach(id=>owned.add(id));
    return {...folder,scopes};
  });
  return {direct:ids.filter(id=>!owned.has(id)),directories};
}

/** One reusable navigation object with account and local-device capability boundaries. */
export const NavigationPreferences=Object.freeze({
  account:Object.freeze({HOME_SETTING_KEY,FAVORITES_SETTING_KEY,DEFAULT_FAVORITES,
    validScopeId,parseFavorites,serializeFavorites,homeScopeForAccount,
    folders:Object.freeze({FOLDERS_SETTING_KEY,MAX_FOLDERS,cleanFolderName,
      normalizeFavoriteFolders,serializeFavoriteFolders,parseFavoriteFolders,visibleFavoriteLayout})}),
  device:Object.freeze({MOBILE_HOME_ID,MOBILE_FAVORITE_STORAGE_KEY,MOBILE_HOME_STORAGE_KEY,
    mobileFavoriteEnabled,mobileHomepageChoice,mobileHomepageEnabled,mobileHomeHref,isMobileHome})
});
