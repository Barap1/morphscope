import { ArrowUpRight, ChartLineUp, Flask, Plus, Scales } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Metric, Panel, StatusBadge, TableShell, type StatusName } from "@morphscope/ui";
import { EmptyWorkspace } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";
import { loadDashboardData, type ExperimentRecord, type StoredRun } from "../../lib/data";

export const dynamic = "force-dynamic";

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

export default function ExperimentsPage() {
  const { experiments, runs, summary } = loadDashboardData();

  if (experiments.length === 0) {
    return (
      <div className="empty-page">
        <PageHeader
          eyebrow="Observe / experiments"
          title="Experiments"
          description="Define a controlled evaluation, keep its runs intact, and inspect the evidence when the runner is connected."
          actions={
            <Link className="ui-button ui-button-secondary" href="/settings#workspace-guide">
              <Plus size={15} weight="bold" aria-hidden /> Setup guide
            </Link>
          }
        />
        <EmptyWorkspace
          icon={<Flask size={21} weight="bold" />}
          eyebrow="No persisted experiment"
          title="Run the fixture to open the ledger."
          description="The dashboard reads .morphscope run and experiment artifacts directly. No empty metrics are invented while the local store has no records."
          action={
            <Link className="ui-button ui-button-primary" href="/settings#workspace-guide">
              Review workspace setup
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="data-page">
      <PageHeader
        eyebrow="Observe / experiments"
        title="The experiment ledger."
        description="Actual persisted runs, configuration matrices, and evaluator outcomes from the local trace store."
        actions={
          <Link className="ui-button ui-button-secondary" href="/settings#workspace-guide">
            Workspace guide <ArrowUpRight size={15} weight="bold" aria-hidden />
          </Link>
        }
      />

      <div className="metrics-grid">
        <Metric
          label="Experiments"
          value={integerFormat.format(experiments.length)}
          detail="manifests discovered locally"
          icon={<Flask size={16} weight="bold" />}
          tone="accent"
        />
        <Metric
          label="Recorded runs"
          value={integerFormat.format(summary.totalRuns)}
          detail={`${summary.resolvedRuns} resolved`}
          icon={<ChartLineUp size={16} weight="bold" />}
          tone="steel"
        />
        <Metric
          label="Resolved rate"
          value={percentFormat.format(summary.resolvedRate)}
          detail={`${summary.scoredRuns} scored runs`}
          icon={<Scales size={16} weight="bold" />}
          tone="success"
        />
        <Metric
          label="Median runtime"
          value={formatDuration(summary.medianRuntimeMs)}
          detail={`${integerFormat.format(summary.totalInputTokens + summary.totalOutputTokens)} tokens`}
          tone="warning"
        />
      </div>

      <div className="split-grid data-section-gap">
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Configuration matrix</span>
              <h2>What was actually run</h2>
            </div>
            <Badge variant="steel">TRACE-BACKED</Badge>
          </div>
          <TableShell caption="Experiments">
            <table>
              <thead>
                <tr>
                  <th scope="col">Experiment</th>
                  <th scope="col">Task</th>
                  <th scope="col">Runs</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Median runtime</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((experiment) => (
                  <ExperimentRow key={experiment.experiment.id} experiment={experiment} />
                ))}
              </tbody>
            </table>
          </TableShell>
        </Panel>
        <ParetoPanel runs={runs} />
      </div>

      <Panel className="data-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Recent evidence</span>
            <h2>Latest run outcomes</h2>
          </div>
          <Link className="ui-button ui-button-quiet ui-button-sm" href="/failures">
            Inspect failures <ArrowUpRight size={14} weight="bold" aria-hidden />
          </Link>
        </div>
        <TableShell caption="Runs ordered by completion time">
          <table>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Task</th>
                <th scope="col">Configuration</th>
                <th scope="col">Terminal</th>
                <th scope="col">Score</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 12).map((storedRun) => (
                <RunRow key={storedRun.run.id} storedRun={storedRun} />
              ))}
            </tbody>
          </table>
        </TableShell>
      </Panel>
    </div>
  );
}

function ExperimentRow({ experiment }: { experiment: ExperimentRecord }) {
  return (
    <tr>
      <td>
        <Link
          className="data-link"
          href={`/experiments/${encodeURIComponent(experiment.experiment.id)}`}
        >
          {experiment.experiment.name}
        </Link>
        <span className="table-subline">{experiment.experiment.id}</span>
      </td>
      <td>
        <Link
          className="table-code"
          href={`/tasks/${encodeURIComponent(experiment.task?.id ?? "unknown")}`}
        >
          {experiment.task?.id ?? "Task metadata unavailable"}
        </Link>
        <span className="table-subline">
          {experiment.task?.tags.slice(0, 2).join(" · ") || "No tags"}
        </span>
      </td>
      <td className="table-number">{experiment.summary.totalRuns}</td>
      <td className="table-number">{percentFormat.format(experiment.summary.resolvedRate)}</td>
      <td className="table-number">{formatDuration(experiment.summary.medianRuntimeMs)}</td>
    </tr>
  );
}

function RunRow({ storedRun }: { storedRun: StoredRun }) {
  return (
    <tr>
      <td>
        <Link
          className="data-link data-link-mono"
          href={`/runs/${encodeURIComponent(storedRun.run.id)}`}
        >
          {storedRun.run.id.slice(0, 8)}
        </Link>
        <span className="table-subline">
          {formatDate(storedRun.run.completedAt ?? storedRun.run.startedAt)}
        </span>
      </td>
      <td>
        <Link className="table-code" href={`/tasks/${encodeURIComponent(storedRun.run.taskId)}`}>
          {storedRun.run.taskId}
        </Link>
      </td>
      <td className="table-code">{storedRun.run.configurationId}</td>
      <td>
        <StatusBadge
          status={statusFor(storedRun.run.terminalState)}
          label={labelFor(storedRun.run.terminalState)}
        />
      </td>
      <td className="table-number">
        {storedRun.run.score === null || storedRun.run.score === undefined
          ? "—"
          : storedRun.run.score}
      </td>
      <td className="table-number">{formatDuration(storedRun.run.totalLatency)}</td>
    </tr>
  );
}

function ParetoPanel({ runs }: { runs: StoredRun[] }) {
  const plotted = runs.slice(0, 24);
  const maxLatency = Math.max(...plotted.map((storedRun) => storedRun.run.totalLatency), 1);
  return (
    <Panel className="data-panel pareto-panel">
      <div className="section-heading">
        <div>
          <span className="section-label">Runtime / correctness</span>
          <h2>Recorded run field</h2>
        </div>
        <Badge variant="accent">LIVE DATA</Badge>
      </div>
      <svg
        className="pareto-chart"
        viewBox="0 0 520 220"
        role="img"
        aria-label="Recorded run runtime and score plot"
      >
        <line x1="44" x2="496" y1="184" y2="184" className="chart-axis" />
        <line x1="44" x2="44" y1="20" y2="184" className="chart-axis" />
        <text x="44" y="207" className="chart-label">
          0 ms
        </text>
        <text x="496" y="207" textAnchor="end" className="chart-label">
          {formatDuration(maxLatency)}
        </text>
        <text x="25" y="186" textAnchor="end" className="chart-label">
          0
        </text>
        <text x="25" y="27" textAnchor="end" className="chart-label">
          1
        </text>
        {plotted.map((storedRun, index) => {
          const score = storedRun.run.score ?? 0;
          const x = 44 + (storedRun.run.totalLatency / maxLatency) * 452;
          const y = 184 - score * 164;
          return (
            <g key={storedRun.run.id}>
              <title>{`${storedRun.run.configurationId} · ${formatDuration(storedRun.run.totalLatency)} · score ${storedRun.run.score ?? "unscored"}`}</title>
              <circle
                cx={x}
                cy={y}
                r={index === 0 ? 6 : 4.5}
                className={storedRun.run.score === 1 ? "chart-dot chart-dot-success" : "chart-dot"}
              />
            </g>
          );
        })}
      </svg>
      <p className="panel-footnote">
        Each dot is a persisted run. Environment failures remain visible but unscored.
      </p>
    </Panel>
  );
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "running") return "running";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function labelFor(state: string): string {
  return state.replaceAll("_", " ");
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
