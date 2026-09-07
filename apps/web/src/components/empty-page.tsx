import { Info, Wrench } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { EmptyState, Panel } from "@morphscope/ui";

export function DevelopmentNotice({ children }: { children: ReactNode }) {
  return (
    <div className="page-note" role="note">
      <Info size={16} weight="bold" aria-hidden />
      <span>
        <strong>Development shell.</strong> {children}
      </span>
    </div>
  );
}

export function EmptyWorkspace({
  icon,
  eyebrow,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      icon={icon}
      eyebrow={eyebrow}
      title={title}
      description={description}
      action={action}
    />
  );
}

export function UnavailablePanel({ title, description }: { title: string; description: string }) {
  return (
    <Panel className="info-panel" tone="steel">
      <div className="callout-heading">
        <Wrench size={16} weight="bold" aria-hidden />
        <span className="section-label">Not connected</span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </Panel>
  );
}
