import type { ReactNode } from "react";

/** Bordered section; the one panel geometry shared by every surface. */
export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
  as: Tag = "section",
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "aside" | "div";
  "aria-label"?: string;
}) {
  return (
    <Tag
      aria-label={ariaLabel}
      className={`border-line bg-surface text-ink min-w-0 border ${className}`}
    >
      {title !== undefined ? (
        <PanelHeader
          title={title}
          description={description}
          actions={actions}
        />
      ) : null}
      {children !== undefined ? (
        <div className={bodyClassName}>{children}</div>
      ) : null}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-line flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
      <div className="mr-auto min-w-0">
        <h2 className="text-body text-ink truncate font-semibold">{title}</h2>
        {description ? (
          <p className="text-micro text-muted mt-0.5">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </header>
  );
}

/** Label/value row inside a <dl>; values are mono because they are measurements. */
export function MetricRow({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="border-line grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-1.5 last:border-b-0">
      <dt className="text-micro text-muted">{label}</dt>
      <dd className={`text-micro font-mono ${tone ?? "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** Small uppercase-free section label used above groups of fields. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-micro text-muted font-semibold">{children}</h3>;
}
