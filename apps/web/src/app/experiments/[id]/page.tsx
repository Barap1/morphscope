import { ArrowLeft, ChartLineUp, Flask, GitBranch, Scales } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Metric, Panel, StatusBadge, TableShell, type StatusName } from "@morphscope/ui";
import { loadExperiment, type ExperimentRecord, type StoredRun } from "../../../lib/data";

export const dynamic = "force-dynamic";

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const experiment = loadExperiment(id);
  if (!experiment) notFound();

  return <ExperimentRecordView experiment={experiment} />;
}

function ExperimentRecordView({ experiment }: { experiment: ExperimentRecord }) {
  const task = experiment.task;
  return (
    <div className="data-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Experiment detail</span>
          <h1>{experiment.experiment.name}</h1>
          <p>
            {task?.id ?? "Task metadata unavailable"} ·{" "}
            {experiment.experiment.taskSetVersion ?? "version not recorded"}
          </p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            <ArrowLeft size={15} weight="bold" aria-hidden /> All experiments
          </Link>
          {experiment.runs.length >= 2 ? (
            <Link className="ui-button ui-button-secondary" href={compareHref(experiment.runs)}>
              <Scales size={15} weight="bold" aria-hidden /> Compare runs
            </Link>
          ) : null}
          <StatusBadge
            status={experimentStatus(experiment)}
            label={experiment.experiment.status ?? "recorded"}
          />
        </div>
      </div>

      <div className="metrics-grid">
        <Metric
          label="Runs"
          value={integerFormat.format(experiment.summary.totalRuns)}
          detail="linked run artifacts"
          icon={<ChartLineUp size={16} weight="bold" />}
          tone="accent"
        />
        <Metric
          label="Resolved"
          value={percentFormat.format(experiment.summary.resolvedRate)}
          detail={`${experiment.summary.resolvedRuns} successful terminal states`}
          tone="success"
        />
        <Metric
          label="Median runtime"
          value={formatDuration(experiment.summary.medianRuntimeMs)}
          detail="per recorded run"
          tone="steel"
        />
        <Metric
          label="Cost"
          value={formatCost(experiment.summary.totalCost)}
          detail={`${integerFormat.format(experiment.summary.totalInputTokens + experiment.summary.totalOutputTokens)} tokens`}
          tone="warning"
        />
      </div>

      <div className="detail-grid data-section-gap">
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Configuration matrix</span>
              <h2>One task, recorded outcomes</h2>
            </div>
            <Badge variant="steel">{experiment.variedVariable ?? "configuration"}</Badge>
          </div>
          <TableShell caption="Configurations and linked runs">
            <table>
              <thead>
                <tr>
                  <th scope="col">Configuration</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Terminal</th>
                  <th scope="col">Score</th>
                  <th scope="col">Trace</th>
                </tr>
              </thead>
              <tbody>
                {(experiment.configurations ?? []).map((configuration) => {
                  const storedRun = experiment.runs.find(
                    (run) => run.run.id === configuration.runId,
                  );
                  return (
                    <ConfigurationRow
                      key={configuration.id}
                      configuration={configuration}
                      storedRun={storedRun}
                    />
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </Panel>
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Task contract</span>
              <h2>{task?.id ?? "Not loaded"}</h2>
            </div>
            <GitBranch size={17} weight="bold" aria-hidden />
          </div>
          <dl className="info-list">
            <div className="info-list-row">
              <dt>Repository</dt>
              <dd className="table-code">
                {task?.repository ?? experiment.task?.repository ?? "Not recorded"}
              </dd>
            </div>
            <div className="info-list-row">
              <dt>Commit</dt>
              <dd className="table-code">
                {task?.commit ?? experiment.task?.commit ?? "Not recorded"}
              </dd>
            </div>
            <div className="info-list-row">
              <dt>Source</dt>
              <dd className="table-code">{experiment.experiment.sourceCommit ?? "Not recorded"}</dd>
            </div>
            <div className="info-list-row">
              <dt>Tags</dt>
              <dd>{task?.tags.join(" · ") || "No tags"}</dd>
            </div>
          </dl>
          {task ? (
            <Link
              className="ui-button ui-button-secondary ui-button-sm data-panel-action"
              href={`/tasks/${encodeURIComponent(task.id)}`}
            >
              Open task <ArrowLeft size={14} weight="bold" aria-hidden className="flip-x" />
            </Link>
          ) : null}
        </Panel>
      </div>

      <ComparisonSignal experiment={experiment} />
    </div>
  );
}

function ConfigurationRow({
  configuration,
  storedRun,
}: {
  configuration: NonNullable<ExperimentRecord["configurations"]>[number];
  storedRun?: StoredRun;
}) {
  return (
    <tr>
      <td className="table-code">{configuration.id}</td>
      <td>
        {configuration.searchProvider ??
          configuration.editProvider ??
          configuration.contextProvider ??
          configuration.routingPolicy ??
          "local baseline"}
      </td>
      <td>
        <StatusBadge
          status={statusFor(
            storedRun?.run.terminalState ?? configuration.terminalState ?? "unavailable",
          )}
          label={labelFor(
            storedRun?.run.terminalState ?? configuration.terminalState ?? "unavailable",
          )}
        />
      </td>
      <td className="table-number">{storedRun?.run.score ?? "n/a"}</td>
      <td>
        {storedRun ? (
          <Link
            className="data-link data-link-mono"
            href={`/runs/${encodeURIComponent(storedRun.run.id)}`}
          >
            {storedRun.run.id.slice(0, 8)}{" "}
            <ArrowLeft size={12} weight="bold" aria-hidden className="turn-right" />
          </Link>
        ) : (
          <span className="muted-value">Not linked</span>
        )}
      </td>
    </tr>
  );
}

function ComparisonSignal({ experiment }: { experiment: ExperimentRecord }) {
  const comparison = experiment.comparison;
  const metrics = comparison && isRecord(comparison.metrics) ? comparison.metrics : null;
  return (
    <Panel className="data-panel comparison-signal">
      <div className="section-heading">
        <div>
          <span className="section-label">Measured divergence</span>
          <h2>What the manifest recorded</h2>
        </div>
        <Scales size={17} weight="bold" aria-hidden />
      </div>
      {metrics ? (
        <div className="signal-grid">
          <Signal label="Search latency" value={deltaValue(metrics.totalSearchLatencyMs, "ms")} />
          <Signal
            label="Context returned"
            value={deltaValue(metrics.bytesContextReturned, "bytes")}
          />
          <Signal label="File recall proxy" value={deltaValue(metrics.fileRecallProxy, "")} />
          <Signal label="Downstream success" value={booleanDelta(metrics.downstreamSuccess)} />
        </div>
      ) : (
        <div className="data-empty-inline">
          <Flask size={16} weight="bold" aria-hidden /> No comparison measurements were persisted
          for this experiment.
        </div>
      )}
      <p className="panel-footnote">
        The interface renders stored measurements only; it does not infer a conclusion from them.
      </p>
    </Panel>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="signal-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function deltaValue(value: unknown, unit: string): string {
  if (!isRecord(value)) return "n/a";
  const delta = typeof value.deltaWarpMinusRaw === "number" ? value.deltaWarpMinusRaw : null;
  if (delta === null) return "n/a";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(delta % 1 === 0 ? 0 : 2)}${unit ? ` ${unit}` : ""}`;
}

function booleanDelta(value: unknown): string {
  if (!isRecord(value)) return "n/a";
  if (value.rawSearch === null || value.warpGrep === null) return "partial";
  return value.rawSearch === value.warpGrep ? "same outcome" : "diverged";
}

function experimentStatus(experiment: ExperimentRecord): StatusName {
  if (experiment.summary.totalRuns === 0) return "unavailable";
  return experiment.summary.resolvedRate === 1 ? "success" : "warning";
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "unavailable") return "unavailable";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function labelFor(state: string): string {
  return state.replaceAll("_", " ");
}

function formatDuration(value: number | null): string {
  if (value === null) return "n/a";
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function compareHref(runs: StoredRun[]): string {
  const [left, right] = runs;
  return `/compare?left=${encodeURIComponent(left.run.id)}&right=${encodeURIComponent(right.run.id)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
