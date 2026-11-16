// Shared placeholder for next/dynamic management panels. A null fallback made
// the page jump (blank, then the panel pops in); this reserves the space.
export default function PanelLoading(){
  return <section className="loc-card" aria-busy="true" style={{minHeight:'7rem'}}>
    <p className="scope-status" role="status">載入中…</p>
  </section>;
}
