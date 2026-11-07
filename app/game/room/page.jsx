import {Suspense} from 'react';
import LocApp from '../../loc/LocApp';
import {LOC_ORIGIN} from '../../seo/metadata';

// A real Next.js App Router segment, statically exported by GitHub Pages.
// The invitation code is read on the client under Suspense; no SSR server
// or dynamic [room] routes are needed to connect through LOC Realtime.
export const metadata={
  title:'加入月之符文線上對戰｜LOC',
  description:'使用房間邀請連結加入 LunaRunes 跨裝置線上牌桌。',
  alternates:{canonical:LOC_ORIGIN+'/game/room/'},
  robots:{index:false,follow:false}
};

export default function GameRoomPage(){
  return <Suspense fallback={<main className="loc-loading" role="status">正在準備線上房間…</main>}>
    <LocApp forcedView="game" forcedScope="lrunes"/>
  </Suspense>;
}
