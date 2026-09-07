import { ArrowUpRight, Bug, Info, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Panel, StatusBadge, TableShell, type StatusName } from "@morphscope/ui";
import { EmptyWorkspace } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";
import { loadRuns } from "../../lib/data";

export const dynamic = "force-dynamic";

export default function FailuresPage() {
  const failures = loadRuns().filter((storedRun) => storedRun.run.terminalState !== "resolved");
  return (
    <div className="data-page">
      <PageHeader
        eyebrow="Analyze / failures"
        title="Failures, with their evidence."
        description="Classify where a run stopped working without collapsing provider, environment, and verification outcomes into one number."
        actions={
          <StatusBadge
            status={failures.length ? "warning" : "unavailable"}
            label={`${failures.length} recorded`}
          />
        }
      />
      {failures.length === 0 ? (
        <EmptyWorkspace
          icon={<Bug size={21} weight="bold" />}
          eyebrow="No failed terminal states"
          title="No unsuccessful runs have been captured."
          description="This view reads persisted run outcomes. It will retain the category, terminal state, relevant spans, and supporting artifacts when a run fails."
          action={
            <Link className="ui-button ui-button-secondary" href="/experiments">
              Go to experiments <ArrowUpRight size={14} weight="bold" aria-hidden />
            </Link>
          }
        />
      ) : (
        <Panel className="data-panel">
          <div className="section-heading">
            <div>
              <span className="section-label">Failure ledger</span>
              <h2>Unsuccessful runs</h2>
            </div>
            <Badge variant="accent">TRACE-BACKED</Badge>
          </div>
          <TableShell caption="Failure records">
            <table>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Task</th>
                  <th scope="col">Category</th>
                  <th scope="col">Terminal</th>
                  <th scope="col">Next evidence</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((storedRun) => {
                  const category =
                    storedRun.evaluation?.failureClassification?.category ??
                    storedRun.run.failureCategory ??
                    "unclassified";
                  return (
                    <tr key={storedRun.run.id}>
                      <td>
                        <Link
                          className="data-link data-link-mono"
                          href={`/runs/${encodeURIComponent(storedRun.run.id)}`}
                        >
                          {storedRun.run.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="table-code">{storedRun.run.taskId}</td>
                      <td>
                        <Badge variant="accent">{category}</Badge>
                      </td>
                      <td>
                        <StatusBadge
                          status={statusFor(storedRun.run.terminalState)}
                          label={storedRun.run.terminalState.replaceAll("_", " ")}
                        />
                      </td>
                      <td>
                        <Link
                          className="data-link"
                          href={`/runs/${encodeURIComponent(storedRun.run.id)}`}
                        >
                          Inspect trace <ArrowUpRight size={13} weight="bold" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        </Panel>
      )}
      <div className="split-grid data-section-gap">
        <Panel className="info-panel" tone="danger">
          <div className="callout-heading">
            <WarningCircle size={16} weight="bold" aria-hidden />
            <span className="section-label">Failure taxonomy</span>
          </div>
          <h2>Keep the cause visible.</h2>
          <p>
            Provider, environment, verification, regression, and budget categories stay distinct in
            persisted analysis metadata.
          </p>
        </Panel>
        <Panel className="info-panel" tone="steel">
          <div className="callout-heading">
            <Info size={16} weight="bold" aria-hidden />
            <span className="section-label">Evidence rule</span>
          </div>
          <h2>Every category has a trace.</h2>
          <p>
            Open a failed run to inspect the exact spans, commands, classification reason, and patch
            evidence that support it.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function statusFor(state: string): StatusName {
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}
