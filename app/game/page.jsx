// Historical route retained for bookmarks; never mount the retired game client.
export const metadata={
  title:'月之符文遊戲暫停提供｜LOC',
  description:'舊版符文牌桌已停用，請前往月之符文首頁使用目前開放的功能。',
  robots:{index:false,follow:false}
};

export default function GameUnavailablePage(){
  return <main className="scope-main" data-loc-scope="lrunes">
    <section className="scope-page">
      <section className="loc-card" role="status">
        <p className="loc-eyebrow">LUNARUNES</p>
        <h1>月之符文遊戲暫停提供</h1>
        <p>舊版牌桌與線上房間已停用。符文規則和已保存的資料不受影響。</p>
        <a className="loc-button" href="/lrunes/">返回符文首頁</a>
      </section>
    </section>
  </main>;
}
