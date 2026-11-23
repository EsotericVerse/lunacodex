// One authoritative navigation contract for LOC's Group, Scope and
// public User docks. The three levels are intentionally NOT interchangeable:
// /manage is Group People/Works, whereas /trace/manage owns Scope space data.
export const LOC_MANAGEMENT_ROUTE_TABLE=Object.freeze({
  group:Object.freeze({
    system:'/admin/',
    keywords:'statics/manage',
    members:'manage',
    articles:'search/manage?section=publish&edit=1'
  }),
  scope:Object.freeze({
    time:'culture/manage',
    keywords:'statics/manage',
    spatial:'trace/manage?section=anchor',
    articles:'search/manage?section=publish'
  }),
  user:Object.freeze({
    culture:'culture',
    statics:'statics',
    trace:'trace',
    search:'search'
  })
});

// Query strings must be appended AFTER converting the pathname to a native
// /index.html route. Passing '?section=...' into navigationHref directly
// would corrupt Capacitor paths as '/?section=.../index.html'.
export function managementRouteHref(level,key,scopeId,{native=false,navigate}={}){
  const route=LOC_MANAGEMENT_ROUTE_TABLE[level]?.[key];
  if(typeof route!=='string')return '';
  // Navigation is supplied by the running Web/Capacitor shell. Keep this
  // lookup table pure: it must not import UI/localization or authority data.
  if(typeof navigate!=='function')
    throw new TypeError('LOC route navigation resolver is required');
  if(level==='group'&&key==='system')
    return native?navigate('loc','admin',true):route;
  const split=route.indexOf('?');
  const pathname=split<0?route:route.slice(0,split);
  const query=split<0?'':route.slice(split+1);
  const href=navigate(scopeId,pathname.replace(/^\/+/,''),native);
  return query?href+(href.includes('?')?'&':'?')+query:href;
}
