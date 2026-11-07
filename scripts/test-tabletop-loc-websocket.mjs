import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tabletopSocketUrl} from '../app/lrunes/game/tabletop-socket.mjs';

const codeId='A1B2C3D4E5F6';
const member='fa44a51f-e251-4edf-8386-9c3cd379864b';
const secret='5dd77d36-0434-4a49-b908-029c89e5127e';
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('online tabletop uses only native WebSockets and does not expose the host secret in invites',()=>{
  const src=file('app/lrunes/game/use-online-tabletop.js');
  const board=file('app/lrunes/game/GameBoard.jsx');
  const gateway=file('app/loc/providers/configured.mjs');
  assert.doesNotMatch(src,/Supabase|dbRealtimeClient|\.channel\(/);
  assert.match(src,/new WebSocket\(url\)/);
  assert.match(board,/hostKey:crypto\.randomUUID\(\)/);
  assert.doesNotMatch(board,/Supabase Realtime/);
  assert.doesNotMatch(gateway,/@supabase\/supabase-js/);
  const host=new URL(tabletopSocketUrl({code:codeId,member,host:true,hostKey:secret}));
  const guest=new URL(tabletopSocketUrl({code:codeId,member}));
  assert.equal(host.pathname,'/room/'+codeId);
  assert.equal(host.searchParams.get('secret'),secret);
  assert.equal(guest.searchParams.has('secret'),false);
  assert.throws(()=>tabletopSocketUrl({code:'../../private',member}),/Invalid/);
  assert.throws(()=>tabletopSocketUrl({code:codeId,member,host:true}),/Invalid/);
  assert.throws(()=>tabletopSocketUrl({code:codeId,member,endpoint:'http://evil.example/'}),/secure WebSocket/);
});

test('room Worker separates host and guests; guests cannot inject game snapshots',async()=>{
  const raw=file('workers/loc-tabletop/index.mjs');
  const code=raw.replace(/^import .*\n/,'').replace('export class TabletopRoom','class TabletopRoom')
    .replace('export default {','const app = {');
  const sockets=[];
  class Socket{
    constructor(){this.messages=[];this.attachment=null;}
    send(text){this.messages.push(JSON.parse(text));}
    serializeAttachment(value){this.attachment=value;}
    deserializeAttachment(){return this.attachment;}
    close(){this.closed=true;}
  }
  class Pair{
    constructor(){this[0]=new Socket();this[1]=new Socket();sockets.push(this[1]);}
  }
  class Reply{
    constructor(_body,{status,webSocket}={}){this.status=status;this.webSocket=webSocket;}
    static json(body,{status}={}){const response=new Reply(null,{status});response.data=body;return response;}
  }
  const context={DurableObject:class{constructor(ctx,env){this.ctx=ctx;this.env=env}},
    WebSocketPair:Pair,Response:Reply,URL,TextEncoder,Date,JSON,Number,String};
  const {TabletopRoom,app}=vm.runInNewContext(code+'\n({TabletopRoom,app})',context);
  const data=new Map(),active=[];
  const ctx={storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),
    setAlarm:async()=>{},deleteAll:async()=>data.clear()},
    getWebSockets:()=>active,acceptWebSocket:s=>active.push(s)};
  const env={TABLETOP_ROOMS:{getByName:()=>room},LOC_GAME_ORIGINS:'https://loc.lo3rwang.cc'};
  const room=new TabletopRoom(ctx,env);
  const req=(role,query='',origin='https://loc.lo3rwang.cc')=>({
    url:'https://game.lo3rwang.cc/room/'+codeId+'?member='+member+'&role='+role+query,
    method:'GET',headers:{get:k=>k==='origin'?origin:k==='upgrade'?'websocket':null}
  });
  assert.equal((await app.fetch(req('guest'),env)).status,404);
  assert.equal((await app.fetch(req('host','&secret='+secret,'https://evil.example'),env)).status,403);
  assert.equal((await app.fetch(req('host','&secret='+secret),env)).status,101);
  assert.equal(data.get('host-secret'),secret);
  assert.equal((await app.fetch(req('host','&secret='+secret),env)).status,409);
  assert.equal((await app.fetch(req('guest'),env)).status,101);
  assert.equal(active.length,2);
  const host=active[0],guest=active[1],state={players:[{},{}],stage:'draw'};
  await room.webSocketMessage(guest,JSON.stringify({type:'state',payload:{state,revision:1}}));
  assert.equal(data.has('snapshot'),false);
  await room.webSocketMessage(guest,JSON.stringify({type:'move',
    payload:{move:'toggleCard',args:[0,'rune-1'],expected:{round:1,stage:'draw'}}}));
  assert.equal(host.messages.some(x=>x.type==='move'),true);
  await room.webSocketMessage(host,JSON.stringify({type:'state',payload:{state,revision:1}}));
  assert.equal(data.get('snapshot').revision,1);
  assert.equal(guest.messages.some(x=>x.type==='state'),true);
  await room.webSocketMessage(host,JSON.stringify({type:'state',payload:{state,revision:1}}));
  assert.equal(data.get('snapshot').revision,1,'revision must be monotonic');
  assert.equal((await app.fetch(req('host','&secret='+crypto.randomUUID()),env)).status,403);
});
