'use client';

// The feature Hero already provides the page title. This shared frame holds
// only the management navigation and editor; keep its accessible name and
// level-specific hooks without rendering a second title card.
const MANAGEMENT_LEVELS=new Set(['scope','group','admin']);

export default function ManagementWorkspaceFrame({
  level='scope',title,children,className=''
}){
  const resolved=MANAGEMENT_LEVELS.has(level)?level:'scope';
  return <section
    className={['management-workspace','management-workspace--unified',
      'management-workspace--'+resolved,className].filter(Boolean).join(' ')}
    data-management-level={resolved}
    aria-label={title}>
    {children}
  </section>;
}
