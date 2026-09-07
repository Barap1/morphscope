import { ArrowLeft, ClipboardText, FileCode, GitBranch } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Metric, Panel, StatusBadge, TableShell, type StatusName } from "@morphscope/ui";
import { loadTaskRuns, loadTaskSummary, type StoredRun } from "../../../lib/data";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = loadTaskSummary(id);
  const runs = loadTaskRuns(id);
  if (!task && runs.length === 0) notFound();

  return (
    <div className="data-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Task detail</span>
          <h1>{task?.id ?? id}</h1>
          <p>{task?.issue ?? "Task metadata was not found, but persisted runs are available."}</p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            <ArrowLeft size={15} weight="bold" aria-hidden /> Experiments
          </Link>
          <Badge variant="steel">{runs.length} runs</Badge>
        </div>
      </div>

      <div className="metrics-grid">
        <Metric
          label="Repository"
          value={task?.repository ?? runs[0]?.run.repositoryCommit ?? "n/a"}
          detail="source location"
          icon={<GitBranch size={16} weight="bold" />}
          tone="steel"
        />
        <Metric
          label="Commit"
          value={task?.commit ?? runs[0]?.run.repositoryCommit ?? "n/a"}
          detail="immutable task source"
          icon={<FileCode size={16} weight="bold" />}
          tone="accent"
        />
        <Metric
          label="Configurations"
          value={String(new Set(runs.map((run) => run.run.configurationId)).size)}
          detail="recorded on this task"
          tone="warning"
        />
        <Metric
          label="Resolved"
          value={String(runs.filter((run) => run.run.terminalState === "resolved").length)}
          detail="terminal outcomes"
          tone="success"
        />
      </div>

      <div className="detail-grid data-section-gap">
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Task contract</span>
              <h2>Reproducibility fields</h2>
            </div>
            <ClipboardText size={17} weight="bold" aria-hidden />
          </div>
          <dl className="info-list">
            <InfoRow label="Issue" value={task?.issue ?? "Not recorded"} />
            <InfoRow label="Repository" value={task?.repository ?? "Not recorded"} />
            <InfoRow
              label="Commit"
              value={task?.commit ?? runs[0]?.run.repositoryCommit ?? "Not recorded"}
            />
            <InfoRow label="Setup" value={task?.setup ?? "Not recorded"} />
            <InfoRow label="Evaluation" value={task?.evaluation ?? "Not recorded"} />
            <InfoRow label="Tags" value={task?.tags.join(" · ") || "No tags"} />
          </dl>
        </Panel>
        <Panel className="data-panel" tone="steel">
          <div className="section-heading">
            <div>
              <span className="section-label">Scope</span>
              <h2>Same task, intact runs</h2>
            </div>
            <GitBranch size={17} weight="bold" aria-hidden />
          </div>
          <p className="data-copy">
            Every row below points to a persisted trace, evaluation result, and patch artifact when
            those outputs were available.
          </p>
          <div className="task-scope-list">
            <span>
              <strong>{new Set(runs.map((run) => run.run.experimentId)).size}</strong> experiments
            </span>
            <span>
              <strong>{new Set(runs.map((run) => run.run.repositoryCommit)).size}</strong> source
              commits
            </span>
            <span>
              <strong>
                {runs.filter((run) => run.run.score !== null && run.run.score !== undefined).length}
              </strong>{" "}
              scored outcomes
            </span>
          </div>
        </Panel>
      </div>

      <Panel className="data-panel">
        <div className="section-heading">
          <div>
            <span className="section-label">Recorded outcomes</span>
            <h2>Runs for this task</h2>
          </div>
          <Badge variant="accent">TRACE-BACKED</Badge>
        </div>
        <TableShell caption="Task runs">
          <table>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Experiment</th>
                <th scope="col">Configuration</th>
                <th scope="col">Outcome</th>
                <th scope="col">Patch</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((storedRun) => (
                <TaskRunRow key={storedRun.run.id} storedRun={storedRun} />
              ))}
            </tbody>
          </table>
        </TableShell>
      </Panel>
    </div>
  );
}

function TaskRunRow({ storedRun }: { storedRun: StoredRun }) {
  const category =
    storedRun.evaluation?.failureClassification?.category ?? storedRun.run.failureCategory;
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
      <td className="table-code">{storedRun.run.experimentId}</td>
      <td className="table-code">{storedRun.run.configurationId}</td>
      <td>
        <StatusBadge
          status={statusFor(storedRun.run.terminalState)}
          label={category ?? storedRun.run.terminalState.replaceAll("_", " ")}
        />
      </td>
      <td>
        {storedRun.patch ? (
          <Badge variant="steel">available</Badge>
        ) : (
          <span className="muted-value">none</span>
        )}
      </td>
    </tr>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-list-row">
      <dt>{label}</dt>
      <dd className="task-info-value">{value}</dd>
    </div>
  );
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
