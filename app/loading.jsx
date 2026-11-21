import StaticContentLoading from './modular/StaticContentLoading';

// App Router streams this inside the already-rendered RootLayout/AppShell.
// NAV, Footer and six-key dock never belong to a page loading fallback.
export default function Loading(){
  return <StaticContentLoading/>;
}
