import {
  ArrowLeft,
  Clock,
  GitDiff,
  Pulse,
  TestTube,
  TreeStructure,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  Badge,
  CodeBlock,
  LogContainer,
  Metric,
  Panel,
  StatusBadge,
  TableShell,
  type StatusName,
} from "@morphscope/ui";
import { loadExperiments, loadRun, type StoredRun, type TraceSpanRecord } from "../../../lib/data";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storedRun = loadRun(id);
  if (!storedRun) notFound();
  return <RunRecordView storedRun={storedRun} />;
}

function RunRecordView({ storedRun }: { storedRun: StoredRun }) {
  const { run, evaluation } = storedRun;
  const experiment = loadExperiments().find((record) =>
    record.runs.some((candidate) => candidate.run.id === run.id),
  );
  const experimentHref = experiment
    ? `/experiments/${encodeURIComponent(experiment.experiment.id)}`
    : "/experiments";
  const classification = evaluation?.failureClassification?.category ?? run.failureCategory;
  const logLines = evaluation?.command
    ? [
        {
          kind: "command" as const,
          content: `$ ${evaluation.command.command ?? "evaluation"} ${(evaluation.command.args ?? []).join(" ")}`,
        },
        ...(evaluation.command.stdout
          ? [{ kind: "info" as const, content: evaluation.command.stdout }]
          : []),
        ...(evaluation.command.stderr
          ? [{ kind: "error" as const, content: evaluation.command.stderr }]
          : []),
      ]
    : [{ kind: "warning" as const, content: "No evaluation command output was persisted." }];

  return (
    <div className="data-page run-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Run replay / {run.configurationId}</span>
          <h1>{run.id}</h1>
          <p>
            {run.taskId} · {run.provider} / {run.model}
          </p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href={experimentHref}>
            <ArrowLeft size={15} weight="bold" aria-hidden /> Experiment
          </Link>
          <StatusBadge
            status={statusFor(run.terminalState)}
            label={run.terminalState.replaceAll("_", " ")}
          />
        </div>
      </div>

      <div className="metrics-grid">
        <Metric
          label="Terminal state"
          value={run.terminalState.replaceAll("_", " ")}
          detail={classification ?? "No failure category"}
          icon={<Pulse size={16} weight="bold" />}
          tone={run.terminalState === "resolved" ? "success" : "warning"}
        />
        <Metric
          label="Score"
          value={run.score === null || run.score === undefined ? "Not scored" : String(run.score)}
          detail="environment failures are excluded"
          icon={<TreeStructure size={16} weight="bold" />}
          tone="accent"
        />
        <Metric
          label="Runtime"
          value={formatDuration(run.totalLatency)}
          detail="wall-clock run latency"
          icon={<Clock size={16} weight="bold" />}
          tone="steel"
        />
        <Metric
          label="Tokens / cost"
          value={`${run.totalInputTokens + run.totalOutputTokens}`}
          detail={formatCost(run.totalCost)}
          icon={<GitDiff size={16} weight="bold" />}
          tone="warning"
        />
      </div>

      <div className="run-replay-grid">
        <Panel className="data-panel timeline-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Trace replay</span>
              <h2>Observed execution timeline</h2>
            </div>
            <Badge variant="steel">{storedRun.trace.spans.length} spans</Badge>
          </div>
          <Timeline spans={storedRun.trace.spans} />
        </Panel>
        <Panel className="data-panel run-identity-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Run identity</span>
              <h2>Evidence links</h2>
            </div>
            <Badge variant="accent">PERSISTED</Badge>
          </div>
          <dl className="info-list">
            <InfoRow
              label="Task"
              value={
                <Link className="data-link" href={`/tasks/${encodeURIComponent(run.taskId)}`}>
                  {run.taskId}
                </Link>
              }
            />
            <InfoRow
              label="Commit"
              value={<span className="table-code">{run.repositoryCommit}</span>}
            />
            <InfoRow
              label="Trace"
              value={<span className="table-code">{run.traceId.slice(0, 12)}…</span>}
            />
            <InfoRow
              label="Patch"
              value={
                storedRun.patch ? (
                  <Badge variant="steel">available</Badge>
                ) : (
                  <span className="muted-value">not persisted</span>
                )
              }
            />
            <InfoRow
              label="Failure"
              value={classification ?? <span className="muted-value">none</span>}
            />
          </dl>
        </Panel>
      </div>

      <div className="split-grid data-section-gap">
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Commands & tests</span>
              <h2>Evaluation output</h2>
            </div>
            <TestTube size={17} weight="bold" aria-hidden />
          </div>
          <LogContainer lines={logLines} label="Persisted evaluation output" />
          <ValidationTable storedRun={storedRun} />
        </Panel>
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Patch evidence</span>
              <h2>Final diff</h2>
            </div>
            <GitDiff size={17} weight="bold" aria-hidden />
          </div>
          {storedRun.patch ? (
            <CodeBlock language="git diff" code={storedRun.patch} />
          ) : (
            <div className="data-empty-inline">No patch artifact was found for this run.</div>
          )}
          {evaluation?.patchStatistics ? (
            <div className="patch-stat-row">
              <span>{evaluation.patchStatistics.changedFiles.length} files</span>
              <span>
                +{evaluation.patchStatistics.linesAdded} / −
                {evaluation.patchStatistics.linesRemoved}
              </span>
              <span>{evaluation.patchStatistics.patchBytes} bytes</span>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function Timeline({ spans }: { spans: TraceSpanRecord[] }) {
  if (spans.length === 0)
    return (
      <div className="data-empty-inline">
        <TreeStructure size={16} weight="bold" aria-hidden /> No spans were persisted for this
        trace.
      </div>
    );
  return (
    <ol className="trace-timeline">
      {spans.slice(0, 48).map((span) => (
        <li className="trace-timeline-item" key={span.spanId}>
          <span className={`trace-node trace-node-${span.status}`} aria-hidden />
          <div className="trace-timeline-copy">
            <div className="trace-timeline-heading">
              <strong>{span.type}</strong>
              <span>
                {formatTime(span.start)} · {span.status}
              </span>
            </div>
            <p>{span.error?.category ?? attributeSummary(span.attributes)}</p>
          </div>
          <span className="trace-duration">
            {span.end ? formatDuration(Date.parse(span.end) - Date.parse(span.start)) : "open"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ValidationTable({ storedRun }: { storedRun: StoredRun }) {
  const validations = storedRun.evaluation?.validations ?? [];
  if (validations.length === 0) return null;
  return (
    <TableShell className="validation-table" caption="Validation checks">
      <table>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Command</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {validations.map((validation) => (
            <tr key={`${validation.kind}-${validation.command}`}>
              <td className="table-code">{validation.kind}</td>
              <td className="table-code">{validation.command}</td>
              <td>
                <StatusBadge
                  status={validation.passed ? "success" : "failed"}
                  label={validation.passed ? "passed" : "failed"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-list-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function attributeSummary(attributes: Record<string, unknown> | undefined): string {
  if (!attributes) return "No span attributes recorded.";
  const meaningful = Object.entries(attributes).filter(
    ([key]) => !key.toLowerCase().includes("query"),
  );
  return (
    meaningful
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" · ") || "No span attributes recorded."
  );
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}
