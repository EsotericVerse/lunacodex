'use client';

// The former MUI/DnD tabletop UI has been retired for a planned rewrite.
// Domain rules, saved game data and rune assets remain; obsolete online
// WebSocket client code has been removed with the undeployed Worker.
export default function GameBoard(){
  return <main className="loc-card" role="status" aria-live="polite"
    style={{maxWidth:760,margin:'1.5rem auto',padding:'2rem'}}>
    <p className="loc-eyebrow">LUNARUNES</p>
    <h1>月之符文遊戲介面重寫中</h1>
    <p>舊版單機與線上牌桌暫停提供，遊戲系統將重新設計。</p>
    <a className="loc-button" href="/lrunes/">返回符文首頁</a>
  </main>;
}
