import { ArrowUpRight, Bug, Info, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Panel, StatusBadge, TableShell, type StatusName } from "@morphscope/ui";
import { EmptyWorkspace } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";
import { loadRuns } from "../../lib/data";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FailuresPage({ searchParams }: { searchParams?: SearchParams }) {
  const allFailures = loadRuns().filter((storedRun) => storedRun.run.terminalState !== "resolved");
  const query = (await searchParams) ?? {};
  const categoryFilter = queryValue(query.category);
  const failures = categoryFilter
    ? allFailures.filter((storedRun) => failureCategory(storedRun) === categoryFilter)
    : allFailures;
  const categoryCounts = [
    ...allFailures.reduce((counts, storedRun) => {
      const category = failureCategory(storedRun);
      counts.set(category, (counts.get(category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  ].sort(([, left], [, right]) => right - left);
  const largestCategory = categoryCounts[0]?.[1] ?? 1;

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
      {allFailures.length === 0 ? (
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
        <>
          <div className="failure-overview">
            <Panel className="data-panel failure-distribution-panel">
              <div className="section-heading">
                <div>
                  <span className="section-label">Failure distribution</span>
                  <h2>Where runs stop</h2>
                </div>
                <Badge variant="accent">{allFailures.length} total</Badge>
              </div>
              <ul className="failure-category-list">
                {categoryCounts.map(([category, count]) => (
                  <li key={category}>
                    <Link
                      className={
                        category === categoryFilter
                          ? "failure-category-link is-active"
                          : "failure-category-link"
                      }
                      href={`/failures?category=${encodeURIComponent(category)}`}
                    >
                      <span className="failure-category-name">{category.replaceAll("_", " ")}</span>
                      <span className="failure-category-count">{count}</span>
                      <span className="failure-category-bar" aria-hidden>
                        <span
                          style={{ width: `${Math.round((count / largestCategory) * 100)}%` }}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel className="data-panel failure-filter-panel" tone="steel">
              <div className="section-heading">
                <div>
                  <span className="section-label">Failure ledger</span>
                  <h2>Inspect representative runs</h2>
                </div>
                <Info size={17} weight="bold" aria-hidden />
              </div>
              <p className="data-copy">
                Categories are recorded at evaluation time. Select one to narrow the evidence rows
                below, then open a trace for the exact stopping point.
              </p>
              <form className="failure-filter-form" method="get" action="/failures">
                <label htmlFor="failure-category">Category</label>
                <select id="failure-category" name="category" defaultValue={categoryFilter}>
                  <option value="">All categories</option>
                  {categoryCounts.map(([category]) => (
                    <option key={category} value={category}>
                      {category.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <div className="failure-filter-actions">
                  <button className="ui-button ui-button-primary ui-button-sm" type="submit">
                    Filter failures
                  </button>
                  {categoryFilter ? (
                    <Link className="ui-button ui-button-quiet ui-button-sm" href="/failures">
                      Clear
                    </Link>
                  ) : null}
                </div>
              </form>
            </Panel>
          </div>
          <Panel className="data-panel">
            <div className="section-heading">
              <div>
                <span className="section-label">Recorded evidence</span>
                <h2>
                  {categoryFilter
                    ? `Runs classified as ${categoryFilter.replaceAll("_", " ")}`
                    : "Unsuccessful runs"}
                </h2>
              </div>
              <Badge variant="steel">TRACE-BACKED</Badge>
            </div>
            {failures.length > 0 ? (
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
                      const category = failureCategory(storedRun);
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
            ) : (
              <div className="data-empty-inline">
                No failed runs match this category. Clear the filter to restore the full ledger.
              </div>
            )}
          </Panel>
          <Panel className="info-panel failure-method-note" tone="steel">
            <div className="callout-heading">
              <WarningCircle size={16} weight="bold" aria-hidden />
              <span className="section-label">Failure taxonomy</span>
            </div>
            <p>
              Provider, environment, verification, regression, application, and budget categories
              stay distinct in persisted analysis metadata. Every category links back to a trace.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function failureCategory(storedRun: ReturnType<typeof loadRuns>[number]): string {
  return (
    storedRun.evaluation?.failureClassification?.category ??
    storedRun.run.failureCategory ??
    "unclassified"
  );
}

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function statusFor(state: string): StatusName {
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}
