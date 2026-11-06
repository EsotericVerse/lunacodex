import {DurableObject} from 'cloudflare:workers';

const ROOM=/^[A-F0-9]{12}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRAME_LIMIT=262144;
const json=(message,status)=>Response.json({error:message},{status,headers:{'cache-control':'no-store'}});

// Ephemeral, one room per Durable Object. No SQL vendor, user accounts, or permanent match history.
export class TabletopRoom extends DurableObject {
  broadcast(message,except=null){
    const data=JSON.stringify(message);
    for(const socket of this.ctx.getWebSockets()){
      if(socket===except)continue;
      try{socket.send(data)}catch{}
    }
  }
  presence(){
    this.broadcast({type:'presence',members:this.ctx.getWebSockets().map(socket=>{
      const {member,role}=socket.deserializeAttachment();
      return {id:member,role};
    })});
  }
  async fetch(request){
    if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return json('WebSocket required',426);
    const url=new URL(request.url);
    const member=url.searchParams.get('member')||'';
    const secret=url.searchParams.get('secret')||'';
    const role=url.searchParams.get('role');
    if(!UUID.test(member)||!['host','guest'].includes(role)||
      role==='host'&&!UUID.test(secret)||role==='guest'&&secret)
      return json('Invalid room participant',400);
    if(this.ctx.getWebSockets().length>=8)return json('Room capacity reached',429);
    const hostSecret=await this.ctx.storage.get('host-secret');
    if(role==='host'){
      if(hostSecret&&hostSecret!==secret)return json('Room owner mismatch',403);
      if(this.ctx.getWebSockets().some(socket=>socket.deserializeAttachment().role==='host'))
        return json('Host is already connected',409);
      if(!hostSecret)await this.ctx.storage.put('host-secret',secret);
    }else if(!hostSecret)return json('Room not found',404);
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({member,role,window:Date.now(),sent:0});
    await this.ctx.storage.setAlarm(Date.now()+2*60*60*1000);
    this.presence();
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(socket,message){
    const state=socket.deserializeAttachment();
    if(typeof message!=='string'||new TextEncoder().encode(message).length>FRAME_LIMIT){
      socket.close(1009,'Frame too large');return;
    }
    const now=Date.now();
    if(now-state.window>=1000){state.window=now;state.sent=0;}
    if(++state.sent>20){socket.close(1008,'Rate limit');return;}
    socket.serializeAttachment(state);
    let entry;try{entry=JSON.parse(message)}catch{return;}
    if(!entry||typeof entry!=='object')return;
    if(entry.type==='request-state'){
      const snapshot=await this.ctx.storage.get('snapshot');
      if(snapshot)socket.send(JSON.stringify({type:'state',payload:snapshot}));
      return;
    }
    if(entry.type==='move'&&state.role==='guest'){
      if(message.length>4096)return; // Moves are tiny; never amplify large guest frames.
      const p=entry.payload;
      if(!p||typeof p.move!=='string'||p.move.length>60||
        !Array.isArray(p.args)||p.args.length>8||
        !p.expected||!Number.isInteger(p.expected.round)||typeof p.expected.stage!=='string')return;
      this.broadcast({type:'move',payload:{move:p.move,args:p.args,
        expected:p.expected,origin:state.member}},socket);
      return;
    }
    if(entry.type==='state'&&state.role==='host'){
      const p=entry.payload;
      if(!p||!Number.isSafeInteger(p.revision)||p.revision<1||
        !p.state||!Array.isArray(p.state.players)||
        p.state.players.length<2||p.state.players.length>4)return;
      const old=await this.ctx.storage.get('snapshot');
      if(old&&p.revision<=old.revision)return;
      const snapshot={state:p.state,revision:p.revision,origin:state.member,
        effect:p.effect||null};
      await this.ctx.storage.put('snapshot',snapshot);
      this.broadcast({type:'state',payload:snapshot},socket);
    }
  }
  async webSocketClose(){this.presence();}
  async webSocketError(){this.presence();}
  async alarm(){
    if(this.ctx.getWebSockets().length){
      await this.ctx.storage.setAlarm(Date.now()+2*60*60*1000);
    }else await this.ctx.storage.deleteAll();
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const origin=request.headers.get('origin')||'';
    const allowed=String(env.LOC_GAME_ORIGINS||'https://loc.lo3rwang.cc')
      .split(',').map(s=>s.trim()).filter(Boolean);
    if(!allowed.includes(origin))return json('Origin not allowed',403);
    if(request.method!=='GET'||!url.pathname.startsWith('/room/'))
      return json('Not found',404);
    const code=url.pathname.slice('/room/'.length);
    if(!ROOM.test(code))return json('Invalid room code',400);
    return env.TABLETOP_ROOMS.getByName(code).fetch(request);
  }
};
