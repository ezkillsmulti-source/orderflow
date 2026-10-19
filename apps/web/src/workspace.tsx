import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';

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
  headingLevel = 2,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  useEffect(() => {
    if (headingLevel === 1) heading.current?.focus();
  }, [headingLevel, title]);
  return (
    <section className="workspace-state" aria-labelledby={id}>
      <Heading
        id={id}
        ref={heading}
        tabIndex={headingLevel === 1 ? -1 : undefined}
      >
        {title}
      </Heading>
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

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="back-link" href={href}>
      <span aria-hidden="true">←</span>
      {children}
    </a>
  );
}
