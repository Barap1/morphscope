import { ArrowUpRight, GitBranch, GitDiff, Info, Scales } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, CodeBlock, Panel, StatusBadge, type StatusName } from "@morphscope/ui";
import { EmptyWorkspace } from "../../components/empty-page";
import { loadDashboardData, type StoredRun, type TraceSpanRecord } from "../../lib/data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Compare",
  description: "Compare trace-backed MorphScope configurations side by side.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type SpanPair = { left: TraceSpanRecord | null; right: TraceSpanRecord | null };

export default async function ComparePage({ searchParams }: { searchParams?: SearchParams }) {
  const { runs } = loadDashboardData();
  const query = (await searchParams) ?? {};
  const allowDifferentTask = queryValue(query.allowDifferentTask) === "1";
  const selection = selectRuns(runs, queryValue(query.left), queryValue(query.right));

  if (runs.length < 2 || !selection) {
    return (
      <div className="empty-page">
        <CompareHeader />
        <EmptyWorkspace
          icon={<Scales size={21} weight="bold" />}
          eyebrow="No comparable pair"
          title="Record two runs to compare the work."
          description="The comparison view needs two persisted runs. The same-task constraint is applied automatically when a pair is available."
          action={
            <Link className="ui-button ui-button-primary" href="/experiments">
              Browse recorded experiments
            </Link>
          }
        />
      </div>
    );
  }

  const sameTask = selection.left.run.taskId === selection.right.run.taskId;

  return (
    <div className="data-page compare-page">
      <CompareHeader />
      <SelectionBar
        runs={runs}
        left={selection.left}
        right={selection.right}
        allowDifferentTask={allowDifferentTask}
      />

      {!sameTask && !allowDifferentTask ? (
        <Panel className="compare-guard" tone="warning" role="alert">
          <div className="callout-heading">
            <Info size={16} weight="bold" aria-hidden />
            <span className="section-label">Same-task guard</span>
          </div>
          <h2>These runs solve different tasks.</h2>
          <p>
            Choose two runs for the same task, or enable the explicit cross-task override above for
            a diagnostic comparison. Results are not presented as a controlled experiment when the
            task identity differs.
          </p>
        </Panel>
      ) : (
        <ComparisonSurface left={selection.left} right={selection.right} />
      )}
    </div>
  );
}

function CompareHeader() {
  return (
    <div className="compare-heading">
      <div>
        <p className="eyebrow">
          <span className="eyebrow-marker" aria-hidden />
          Analyze / comparison
        </p>
        <h1>Compare the evidence.</h1>
        <p>
          Synchronize two persisted traces, find the first meaningful divergence, and keep the patch
          and outcome visible beside it.
        </p>
      </div>
      <Badge variant="accent">TRACE-BACKED</Badge>
    </div>
  );
}

function SelectionBar({
  runs,
  left,
  right,
  allowDifferentTask,
}: {
  runs: StoredRun[];
  left: StoredRun;
  right: StoredRun;
  allowDifferentTask: boolean;
}) {
  return (
    <Panel className="compare-selection-panel">
      <div className="section-heading">
        <div>
          <span className="section-label">Comparison controls</span>
          <h2>Select the runs</h2>
        </div>
        <span className="table-subline">GET parameters keep the view linkable.</span>
      </div>
      <form className="compare-selection-form" method="get" action="/compare">
        <label>
          <span>Left trace</span>
          <select name="left" defaultValue={left.run.id}>
            {runs.map((storedRun) => (
              <RunOption key={storedRun.run.id} storedRun={storedRun} />
            ))}
          </select>
        </label>
        <label>
          <span>Right trace</span>
          <select name="right" defaultValue={right.run.id}>
            {runs.map((storedRun) => (
              <RunOption key={storedRun.run.id} storedRun={storedRun} />
            ))}
          </select>
        </label>
        <label className="compare-checkbox">
          <input
            type="checkbox"
            name="allowDifferentTask"
            value="1"
            defaultChecked={allowDifferentTask}
          />
          <span>Allow cross-task diagnostic</span>
        </label>
        <button className="ui-button ui-button-primary" type="submit">
          Compare traces <ArrowUpRight size={15} weight="bold" aria-hidden />
        </button>
      </form>
    </Panel>
  );
}

function RunOption({ storedRun }: { storedRun: StoredRun }) {
  const { run } = storedRun;
  return (
    <option value={run.id}>
      {run.configurationId} · {run.taskId} · {run.id.slice(0, 8)}
    </option>
  );
}

function ComparisonSurface({ left, right }: { left: StoredRun; right: StoredRun }) {
  const rows = alignSpans(left.trace.spans, right.trace.spans);
  const firstDivergence = rows.findIndex((row) => isDivergent(row));
  const leftEvidence = traceEvidence(left);
  const rightEvidence = traceEvidence(right);

  return (
    <>
      <div className="compare-run-heads">
        <RunHead storedRun={left} side="left" />
        <RunHead storedRun={right} side="right" />
      </div>

      <Panel className="compare-first-panel" tone={firstDivergence >= 0 ? "accent" : "steel"}>
        <div className="compare-first-copy">
          <span className="section-label">First meaningful divergence</span>
          <h2>
            {firstDivergence >= 0
              ? `Event ${firstDivergence + 1}: ${divergenceLabel(rows[firstDivergence])}`
              : "The recorded timelines stay aligned."}
          </h2>
          <p>
            {firstDivergence >= 0
              ? "The comparison marks this row so the downstream changes can be inspected without inferring a performance conclusion."
              : "No span-level divergence was found in the persisted traces."}
          </p>
        </div>
        <div className="compare-first-marker" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </Panel>

      <MetricDeltaPanel left={left} right={right} />

      <Panel className="data-panel compare-timeline-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Synchronized replay</span>
            <h2>Where the traces separate</h2>
          </div>
          <Badge variant="steel">{rows.length} aligned events</Badge>
        </div>
        {rows.length > 0 ? (
          <ol className="compare-timeline" aria-label="Synchronized trace timeline">
            {rows.map((row, index) => (
              <CompareTimelineRow
                key={`${row.left?.spanId ?? "left"}-${row.right?.spanId ?? "right"}`}
                row={row}
                index={index}
              />
            ))}
          </ol>
        ) : (
          <div className="data-empty-inline">Neither run persisted trace spans.</div>
        )}
      </Panel>

      <Panel className="data-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Retrieval / edit evidence</span>
            <h2>What each run inspected</h2>
          </div>
          <Badge variant="accent">TECHNICAL DETAIL</Badge>
        </div>
        <div className="compare-evidence-grid">
          <EvidenceColumn label={left.run.configurationId} evidence={leftEvidence} />
          <EvidenceColumn label={right.run.configurationId} evidence={rightEvidence} />
        </div>
      </Panel>

      <Panel className="data-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Patch evidence</span>
            <h2>Side-by-side final diffs</h2>
          </div>
          <GitDiff size={17} weight="bold" aria-hidden />
        </div>
        <div className="compare-diff-grid">
          <DiffColumn label={left.run.configurationId} storedRun={left} />
          <DiffColumn label={right.run.configurationId} storedRun={right} />
        </div>
      </Panel>

      <Panel className="data-panel compare-outcome-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Verification / outcome</span>
            <h2>What changed after the divergence</h2>
          </div>
          <GitBranch size={17} weight="bold" aria-hidden />
        </div>
        <div className="compare-outcome-grid">
          <OutcomeColumn label={left.run.configurationId} storedRun={left} />
          <OutcomeColumn label={right.run.configurationId} storedRun={right} />
        </div>
      </Panel>
    </>
  );
}

function RunHead({ storedRun, side }: { storedRun: StoredRun; side: "left" | "right" }) {
  const { run } = storedRun;
  return (
    <Panel className={`compare-run-head compare-run-head-${side}`}>
      <div className="compare-run-head-top">
        <span className="section-label">
          {side === "left" ? "Configuration A" : "Configuration B"}
        </span>
        <StatusBadge
          status={statusFor(run.terminalState)}
          label={run.terminalState.replaceAll("_", " ")}
        />
      </div>
      <h2>{run.configurationId}</h2>
      <p>
        {run.provider} / {run.model}
      </p>
      <div className="compare-run-meta">
        <span>{run.taskId}</span>
        <span className="table-code">{run.id.slice(0, 12)}…</span>
      </div>
      <Link className="data-link" href={`/runs/${encodeURIComponent(run.id)}`}>
        Open full replay <ArrowUpRight size={14} weight="bold" aria-hidden />
      </Link>
    </Panel>
  );
}

function MetricDeltaPanel({ left, right }: { left: StoredRun; right: StoredRun }) {
  const values = comparisonMetrics(left, right);
  return (
    <Panel className="data-panel metric-delta-panel">
      <div className="section-heading">
        <div>
          <span className="section-label">Measured delta</span>
          <h2>Same task, different path</h2>
        </div>
        <Badge variant="steel">B − A</Badge>
      </div>
      <div className="metric-delta-list">
        {values.map((metric) => (
          <div className="metric-delta-row" key={metric.label}>
            <div className="metric-delta-label">
              <span>{metric.label}</span>
              <strong>{metric.deltaLabel}</strong>
            </div>
            <div className="metric-delta-values">
              <span>{metric.left}</span>
              <span>{metric.right}</span>
            </div>
            <div className="metric-delta-bar" aria-hidden>
              <span className="metric-delta-bar-left" style={{ width: `${metric.leftWidth}%` }} />
              <span className="metric-delta-bar-right" style={{ width: `${metric.rightWidth}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CompareTimelineRow({ row, index }: { row: SpanPair; index: number }) {
  const divergent = isDivergent(row);
  return (
    <li className={divergent ? "compare-timeline-row is-divergent" : "compare-timeline-row"}>
      <div className="compare-timeline-index">{String(index + 1).padStart(2, "0")}</div>
      <TimelineSide span={row.left} side="left" />
      <div className="compare-timeline-connector" aria-hidden>
        <span />
        {divergent ? <strong>Δ</strong> : <span />}
        <span />
      </div>
      <TimelineSide span={row.right} side="right" />
      {divergent ? <span className="compare-divergence-mark">diverged</span> : null}
    </li>
  );
}

function TimelineSide({ span, side }: { span: TraceSpanRecord | null; side: "left" | "right" }) {
  return (
    <div className={`compare-timeline-side compare-timeline-side-${side}`}>
      {span ? (
        <>
          <strong>{span.type}</strong>
          <span>{spanSummary(span)}</span>
          <small>
            {span.status} ·{" "}
            {span.end ? formatDuration(Date.parse(span.end) - Date.parse(span.start)) : "open"}
          </small>
        </>
      ) : (
        <span className="compare-missing">No corresponding span</span>
      )}
      {span ? (
        <details className="compare-technical-detail">
          <summary>technical detail</summary>
          <CodeBlock language="json" code={JSON.stringify(span.attributes ?? {}, null, 2)} />
        </details>
      ) : null}
    </div>
  );
}

function EvidenceColumn({ label, evidence }: { label: string; evidence: TraceEvidence }) {
  return (
    <div className="compare-evidence-column">
      <div className="compare-column-label">{label}</div>
      <dl className="compare-evidence-list">
        <EvidenceRow label="Search selection" value={evidence.searchSelection} />
        <EvidenceRow label="Search results" value={evidence.searchResults} />
        <EvidenceRow label="Files read" value={evidence.filesRead} />
        <EvidenceRow label="Edit strategy" value={evidence.editStrategy} />
        <EvidenceRow label="Context size" value={evidence.contextSize} />
        <EvidenceRow label="Tests" value={evidence.tests} />
      </dl>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="compare-evidence-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DiffColumn({ label, storedRun }: { label: string; storedRun: StoredRun }) {
  return (
    <div className="compare-diff-column">
      <div className="compare-column-label">{label}</div>
      {storedRun.patch ? (
        <CodeBlock language="git diff" code={storedRun.patch} />
      ) : (
        <div className="data-empty-inline">No patch artifact persisted.</div>
      )}
    </div>
  );
}

function OutcomeColumn({ label, storedRun }: { label: string; storedRun: StoredRun }) {
  const validations = storedRun.evaluation?.validations ?? [];
  return (
    <div className="compare-outcome-column">
      <div className="compare-column-label">{label}</div>
      <div className="compare-outcome-state">
        <StatusBadge
          status={statusFor(storedRun.run.terminalState)}
          label={storedRun.run.terminalState.replaceAll("_", " ")}
        />
        <span className="table-code">
          {storedRun.run.score === null || storedRun.run.score === undefined
            ? "unscored"
            : `score ${storedRun.run.score}`}
        </span>
      </div>
      <div className="compare-validation-list">
        {validations.length > 0
          ? validations.map((validation) => (
              <div key={`${validation.kind}-${validation.command}`}>
                <span>{validation.kind}</span>
                <StatusBadge
                  status={validation.passed ? "success" : "failed"}
                  label={validation.passed ? "passed" : "failed"}
                />
              </div>
            ))
          : "No validation checks persisted."}
      </div>
    </div>
  );
}

type TraceEvidence = {
  searchSelection: string;
  searchResults: string;
  filesRead: string;
  editStrategy: string;
  contextSize: string;
  tests: string;
};

function traceEvidence(storedRun: StoredRun): TraceEvidence {
  const searchSpan = storedRun.trace.spans.find((span) => span.type === "search");
  const searchAttributes = searchSpan?.attributes ?? {};
  const uniqueFiles = stringAttribute(searchAttributes, "uniqueFiles");
  const readFiles = storedRun.trace.spans
    .filter((span) => span.type.includes("read_file"))
    .map((span) => stringAttribute(span.attributes, "path"))
    .filter(Boolean);
  const validationCount = storedRun.evaluation?.validations?.length ?? 0;
  return {
    searchSelection: stringAttribute(searchAttributes, "provider") || "No search span",
    searchResults: stringAttribute(searchAttributes, "query") || "No query recorded",
    filesRead: readFiles.length > 0 ? readFiles.join(", ") : uniqueFiles || "No files recorded",
    editStrategy:
      storedRun.trace.spans.find((span) => /replace|apply|edit/u.test(span.type))?.type ??
      "No edit span",
    contextSize: searchAttributes.contextBytes
      ? `${String(searchAttributes.contextBytes)} bytes`
      : "Not recorded",
    tests: validationCount > 0 ? `${validationCount} persisted checks` : "Evaluation output only",
  };
}

function comparisonMetrics(left: StoredRun, right: StoredRun) {
  return [
    numericMetric("Latency", left.run.totalLatency, right.run.totalLatency, formatDuration),
    numericMetric("Total tokens", totalTokens(left), totalTokens(right), (value) =>
      integerFormat.format(value),
    ),
    costMetric(left, right),
    numericMetric(
      "Changed files",
      left.evaluation?.patchStatistics?.changedFiles.length ?? 0,
      right.evaluation?.patchStatistics?.changedFiles.length ?? 0,
      (value) => integerFormat.format(value),
    ),
    numericMetric("Patch lines", patchLines(left), patchLines(right), (value) =>
      integerFormat.format(value),
    ),
  ];
}

function numericMetric(
  label: string,
  left: number,
  right: number,
  formatter: (value: number) => string,
) {
  const max = Math.max(left, right, 1);
  return {
    label,
    left: formatter(left),
    right: formatter(right),
    deltaLabel: `Δ ${formatter(right - left)}`,
    leftWidth: Math.max(4, Math.round((left / max) * 100)),
    rightWidth: Math.max(4, Math.round((right / max) * 100)),
  };
}

function costMetric(left: StoredRun, right: StoredRun) {
  const leftReported = left.run.costBasis === "provider_reported";
  const rightReported = right.run.costBasis === "provider_reported";
  return {
    label: "Cost",
    left: formatRunCost(left),
    right: formatRunCost(right),
    deltaLabel:
      leftReported && rightReported
        ? `Δ ${formatCost(right.run.totalCost - left.run.totalCost)}`
        : "Δ unavailable",
    leftWidth: leftReported
      ? Math.max(
          4,
          Math.round(
            (left.run.totalCost / Math.max(left.run.totalCost, right.run.totalCost, 1)) * 100,
          ),
        )
      : 4,
    rightWidth: rightReported
      ? Math.max(
          4,
          Math.round(
            (right.run.totalCost / Math.max(left.run.totalCost, right.run.totalCost, 1)) * 100,
          ),
        )
      : 4,
  };
}

function formatRunCost(run: StoredRun): string {
  if (run.run.costBasis === "provider_reported") return formatCost(run.run.totalCost);
  if (run.run.costBasis === "nominal_estimate") return `Nominal ${formatCost(run.run.totalCost)}`;
  return "n/a";
}

function alignSpans(left: TraceSpanRecord[], right: TraceSpanRecord[]): SpanPair[] {
  const rows: SpanPair[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftSpan = left[leftIndex] ?? null;
    const rightSpan = right[rightIndex] ?? null;
    if (leftSpan && rightSpan && leftSpan.type === rightSpan.type) {
      rows.push({ left: leftSpan, right: rightSpan });
      leftIndex += 1;
      rightIndex += 1;
    } else if (leftSpan && right[rightIndex + 1]?.type === leftSpan.type) {
      rows.push({ left: null, right: rightSpan });
      rightIndex += 1;
    } else if (rightSpan && left[leftIndex + 1]?.type === rightSpan.type) {
      rows.push({ left: leftSpan, right: null });
      leftIndex += 1;
    } else {
      rows.push({ left: leftSpan, right: rightSpan });
      leftIndex += leftSpan ? 1 : 0;
      rightIndex += rightSpan ? 1 : 0;
    }
  }
  return rows;
}

function isDivergent(row: SpanPair): boolean {
  if (!row.left || !row.right) return true;
  return row.left.type !== row.right.type || row.left.status !== row.right.status;
}

function divergenceLabel(row: SpanPair): string {
  if (!row.left) return `${row.right?.type ?? "unknown"} appears only on B`;
  if (!row.right) return `${row.left.type} appears only on A`;
  return row.left.type === row.right.type
    ? `${row.left.type} status differs`
    : `${row.left.type} vs ${row.right.type}`;
}

function spanSummary(span: TraceSpanRecord): string {
  const attributes = span.attributes ?? {};
  const summary = Object.entries(attributes)
    .filter(([key]) => !key.toLowerCase().includes("query"))
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
  return summary || "No span attributes recorded.";
}

function selectRuns(runs: StoredRun[], leftId?: string, rightId?: string) {
  const explicitLeft = leftId ? runs.find((storedRun) => storedRun.run.id === leftId) : undefined;
  const explicitRight = rightId
    ? runs.find((storedRun) => storedRun.run.id === rightId)
    : undefined;
  if (explicitLeft && explicitRight) return { left: explicitLeft, right: explicitRight };

  const byTask = new Map<string, StoredRun[]>();
  for (const storedRun of runs) {
    const taskRuns = byTask.get(storedRun.run.taskId) ?? [];
    taskRuns.push(storedRun);
    byTask.set(storedRun.run.taskId, taskRuns);
  }
  const group = [...byTask.values()].find((taskRuns) => taskRuns.length >= 2);
  if (!group) return null;
  const left = explicitLeft ?? preferredRun(group, ["baseline", "raw-search"]) ?? group[0];
  const right =
    explicitRight ??
    preferredRun(
      group.filter((storedRun) => storedRun.run.id !== left.run.id),
      ["warpgrep"],
    ) ??
    group.find((storedRun) => storedRun.run.id !== left.run.id);
  return right ? { left, right } : null;
}

function preferredRun(runs: StoredRun[], configurations: string[]): StoredRun | undefined {
  for (const configuration of configurations) {
    const candidates = runs.filter((storedRun) => storedRun.run.configurationId === configuration);
    const resolved = candidates.find((storedRun) => storedRun.run.terminalState === "resolved");
    if (resolved) return resolved;
    if (candidates[0]) return candidates[0];
  }
  return undefined;
}

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stringAttribute(attributes: Record<string, unknown> | undefined, key: string): string {
  const value = attributes?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function totalTokens(storedRun: StoredRun): number {
  return storedRun.run.totalInputTokens + storedRun.run.totalOutputTokens;
}

function patchLines(storedRun: StoredRun): number {
  const stats = storedRun.evaluation?.patchStatistics;
  return stats ? stats.linesAdded + stats.linesRemoved : 0;
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
