import { useId, type ReactNode, type Ref } from 'react';

export function PageHeader({
  title,
  description,
  eyebrow = 'Product workspace',
  actions,
  headingRef,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function WorkspaceState({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="workspace-state" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="state-description">{children}</div>
      {actions && <div className="row state-actions">{actions}</div>}
    </section>
  );
}
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-indicator" aria-hidden="true" />
      {children}
    </div>
  );
}
