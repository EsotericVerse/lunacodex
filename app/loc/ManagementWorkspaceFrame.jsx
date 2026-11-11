'use client';

// Shared visual shell for Scope, Scope Group and Admin management.
// Keep each page's existing data access, permissions and editor lifecycle.
const LEVEL_LABELS=Object.freeze({
  scope:'內容',
  group:'群組',
  admin:'系統'
});

export default function ManagementWorkspaceFrame({
  level='scope',title,description='',children,className=''
}){
  const resolved=Object.hasOwn(LEVEL_LABELS,level)?level:'scope';
  return <section
    className={['management-workspace','management-workspace--unified',
      'management-workspace--'+resolved,className].filter(Boolean).join(' ')}
    data-management-level={resolved}
    aria-label={title}>
    <header className="management-workspace__header">
      <p className="management-workspace__level">{LEVEL_LABELS[resolved]}</p>
      <h2 className="management-workspace__heading">{title}</h2>
      {description?<p className="management-workspace__description">{description}</p>:null}
    </header>
    {children}
  </section>;
}
