import {
  CheckCircle,
  CircleNotch,
  Info,
  MinusCircle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/ssr";
import { clsx } from "clsx";
import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";

type Tone = "neutral" | "accent" | "steel" | "success" | "warning" | "danger";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <CircleNotch className="ui-button-spinner" size={15} weight="bold" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export type BadgeProps = ComponentPropsWithoutRef<"span"> & {
  variant?: "neutral" | "accent" | "steel";
};

export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  return (
    <span className={clsx("ui-badge", `ui-badge-${variant}`, className)} {...props}>
      {children}
    </span>
  );
}

export type StatusName =
  "neutral" | "ready" | "running" | "success" | "warning" | "failed" | "unavailable";

export type StatusBadgeProps = ComponentPropsWithoutRef<"span"> & {
  status: StatusName;
  label: string;
};

type StatusIconProps = {
  size?: number;
  weight?: "bold" | "fill" | "regular";
  className?: string;
  "aria-hidden"?: boolean;
};

const statusIcons: Record<StatusName, ComponentType<StatusIconProps>> = {
  neutral: MinusCircle,
  ready: Info,
  running: CircleNotch,
  success: CheckCircle,
  warning: WarningCircle,
  failed: XCircle,
  unavailable: MinusCircle,
};

export function StatusBadge({ className, status, label, ...props }: StatusBadgeProps) {
  const Icon = statusIcons[status];

  return (
    <span
      className={clsx("ui-status", `ui-status-${status}`, className)}
      data-status={status}
      {...props}
    >
      <Icon
        className={status === "running" ? "ui-status-spin" : undefined}
        size={14}
        weight="bold"
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}

export type PanelProps = ComponentPropsWithoutRef<"section"> & {
  tone?: Tone;
  compact?: boolean;
};

export function Panel({
  className,
  tone = "neutral",
  compact = false,
  children,
  ...props
}: PanelProps) {
  return (
    <section
      className={clsx("ui-panel", `ui-panel-${tone}`, compact && "ui-panel-compact", className)}
      {...props}
    >
      {children}
    </section>
  );
}

export type MetricProps = {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
};

export function Metric({ label, value, detail, icon, tone = "neutral", className }: MetricProps) {
  return (
    <div className={clsx("ui-metric", `ui-metric-${tone}`, className)}>
      <div className="ui-metric-heading">
        <span className="ui-metric-label">{label}</span>
        {icon ? (
          <span className="ui-metric-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="ui-metric-value">{value}</div>
      {detail ? <div className="ui-metric-detail">{detail}</div> : null}
    </div>
  );
}

export type TableShellProps = ComponentPropsWithoutRef<"div"> & {
  caption?: string;
};

export function TableShell({ className, caption, children, ...props }: TableShellProps) {
  return (
    <div className={clsx("ui-table-shell", className)} {...props}>
      {caption ? <div className="ui-table-caption">{caption}</div> : null}
      <div
        className="ui-table-scroll"
        role="region"
        aria-label={caption ?? "Scrollable table"}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}

export type CodeBlockProps = ComponentPropsWithoutRef<"pre"> & {
  code: string;
  language?: string;
};

export function CodeBlock({ className, code, language = "text", ...props }: CodeBlockProps) {
  return (
    <pre
      className={clsx("ui-code-block", className)}
      data-language={language}
      tabIndex={0}
      {...props}
    >
      <code>{code}</code>
    </pre>
  );
}

export type LogLine = {
  content: string;
  timestamp?: string;
  kind?: "info" | "command" | "success" | "warning" | "error";
};

export type LogContainerProps = ComponentPropsWithoutRef<"div"> & {
  lines: readonly LogLine[];
  label?: string;
};

export function LogContainer({
  className,
  lines,
  label = "Log output",
  ...props
}: LogContainerProps) {
  return (
    <div
      className={clsx("ui-log-container", className)}
      role="log"
      aria-label={label}
      tabIndex={0}
      {...props}
    >
      {lines.map((line, index) => (
        <div
          className={clsx("ui-log-line", line.kind && `ui-log-${line.kind}`)}
          key={`${line.timestamp ?? "line"}-${index}`}
        >
          {line.timestamp ? <span className="ui-log-time">{line.timestamp}</span> : null}
          <span className="ui-log-content">{line.content}</span>
        </div>
      ))}
    </div>
  );
}

export type EmptyStateProps = ComponentPropsWithoutRef<"div"> & {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({
  className,
  icon,
  eyebrow,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div className={clsx("ui-empty-state", className)} {...props}>
      {icon ? (
        <div className="ui-empty-icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      {eyebrow ? <p className="ui-overline">{eyebrow}</p> : null}
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}

export type SkeletonProps = ComponentPropsWithoutRef<"div"> & {
  width?: string;
  height?: string;
};

export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
  return (
    <div
      className={clsx("ui-skeleton", className)}
      style={{ ...style, width, height }}
      aria-hidden
      {...props}
    />
  );
}

export type LoadingStateProps = ComponentPropsWithoutRef<"div"> & {
  label?: string;
};

export function LoadingState({
  className,
  label = "Loading workspace…",
  ...props
}: LoadingStateProps) {
  return (
    <div className={clsx("ui-loading-state", className)} role="status" {...props}>
      <CircleNotch className="ui-status-spin" size={18} weight="bold" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export type ErrorStateProps = ComponentPropsWithoutRef<"div"> & {
  title?: string;
  description: string;
  action?: ReactNode;
};

export function ErrorState({
  className,
  title = "This view could not load",
  description,
  action,
  ...props
}: ErrorStateProps) {
  return (
    <div className={clsx("ui-error-state", className)} role="alert" {...props}>
      <div className="ui-empty-icon" aria-hidden>
        <WarningCircle size={20} weight="bold" />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {action ? <div className="ui-empty-action">{action}</div> : null}
      </div>
    </div>
  );
}
