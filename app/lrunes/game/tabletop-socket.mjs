const ROOM=/^[A-F0-9]{12}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The matchmaking service is a small LOC Worker, not a database provider.
export function tabletopSocketUrl({code,member,host=false,hostKey='',
  endpoint=process.env.NEXT_PUBLIC_LOC_TABLETOP_WS_URL||'wss://game.lo3rwang.cc'}={}){
  if(!ROOM.test(code)||!UUID.test(member)||host&&!UUID.test(hostKey))
    throw new Error('Invalid LOC tabletop room credentials');
  const base=new URL(endpoint);
  if(base.protocol!=='wss:'||base.username||base.password||base.search||base.hash||
    base.pathname!=='/'&&!base.pathname.endsWith('/'))
    throw new Error('LOC tabletop requires a dedicated secure WebSocket origin');
  const url=new URL(base.href.replace(/\/+$/,'')+'/room/'+code);
  url.searchParams.set('member',member);
  url.searchParams.set('role',host?'host':'guest');
  if(host)url.searchParams.set('secret',hostKey);
  return url.href;
}
