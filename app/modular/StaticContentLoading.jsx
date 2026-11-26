import ActivityMotion from './ActivityMotion';

// Content-only first paint. RootLayout's existing AppShell renders the
// static NAV, six-key dock and Footer before page code/data resolves.
// No second shell, route change, permissions request, or loading timer.
export default function StaticContentLoading({label='正在載入頁面內容…'}){
  return <main className="scope-main" aria-busy="true">
    <section className="scope-page">
      <div className="scope-content">
        <section className="loc-card loc-feature-pending" role="status">
          <p className="scope-status"><ActivityMotion/> {label}</p>
        </section>
      </div>
    </section>
  </main>;
}
