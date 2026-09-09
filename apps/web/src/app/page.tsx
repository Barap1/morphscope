import {
  ArrowUpRight,
  ChartLineUp,
  PlayCircle,
  Scales,
  TreeStructure,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import Image from "next/image";
import { Badge, Metric, Panel, StatusBadge, type StatusName } from "@morphscope/ui";
import { isPublishedDashboard, loadDashboardData, loadPublishedProvenance } from "../lib/data";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const { experiments, runs, summary } = loadDashboardData();
  const latest = runs[0];
  const published = isPublishedDashboard();
  const provenance = published ? loadPublishedProvenance() : null;
  return (
    <div className="overview-page">
      <section className="hero-panel" aria-labelledby="overview-title">
        <div className="hero-art" aria-hidden>
          <Image
            src="/brand/morphscope-optic.png"
            alt=""
            fill
            priority
            quality={68}
            sizes="(max-width: 760px) 100vw, 58vw"
          />
        </div>
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-marker" aria-hidden />
            Trace-first evaluation workspace
          </p>
          <h1 id="overview-title">
            See the work <em>between</em> the prompt and the patch.
          </h1>
          <p>
            MorphScope is built to show how a coding agent searches, reasons, edits, and verifies
            work across a real repository. Every result will be grounded in an actual trace.
          </p>
          <div className="hero-actions">
            <Link className="ui-button ui-button-primary ui-button-lg" href="/experiments">
              Open experiments <PlayCircle size={16} weight="bold" aria-hidden />
            </Link>
            {latest ? (
              <Link
                className="ui-button ui-button-secondary ui-button-lg"
                href={`/runs/${encodeURIComponent(latest.run.id)}`}
              >
                Replay latest trace <ArrowUpRight size={16} weight="bold" aria-hidden />
              </Link>
            ) : (
              <Link
                className="ui-button ui-button-secondary ui-button-lg"
                href="/settings#workspace-guide"
              >
                Prepare workspace <ArrowUpRight size={16} weight="bold" aria-hidden />
              </Link>
            )}
          </div>
          <div className="hero-annotations">
            <span className="hero-annotations-rule" aria-hidden />
            <span>TRACE / REASON / APPLY / VERIFY</span>
          </div>
        </div>

        <aside className="hero-observatory" aria-label="Workspace status">
          <div className="observatory-header">
            <span className="observatory-label">Workspace status</span>
            <StatusBadge
              status={latest ? statusFor(latest.run.terminalState) : "unavailable"}
              label={latest ? latest.run.terminalState.replaceAll("_", " ") : "No runs yet"}
            />
          </div>
          <div className="observatory-viewport">
            {latest ? (
              <div className="observatory-live-card">
                <span className="observatory-live-kicker">LATEST TRACE</span>
                <strong>{latest.run.configurationId}</strong>
                <code>{latest.run.id}</code>
                <span>
                  {latest.trace.spans.length} spans ·{" "}
                  {latest.run.score === null ? "not scored" : `score ${latest.run.score}`}
                </span>
              </div>
            ) : (
              <>
                <div className="observatory-aperture" aria-hidden>
                  <span />
                  <span />
                </div>
                <div className="observatory-empty-copy">Your first trace will appear here.</div>
              </>
            )}
          </div>
          <div className="observatory-footer">
            <span>DATA SOURCE</span>
            <strong>
              {latest
                ? published
                  ? "Published read-only snapshot"
                  : "Persisted local trace"
                : "Awaiting local trace"}
            </strong>
          </div>
        </aside>
      </section>

      {latest ? (
        <section className="overview-live-section" aria-labelledby="live-summary-title">
          <div className="section-heading">
            <div>
              <span className="section-label">Workspace signal</span>
              <h2 id="live-summary-title">The latest evidence is in view.</h2>
            </div>
            <Link
              className="ui-button ui-button-quiet ui-button-sm"
              href={`/runs/${encodeURIComponent(latest.run.id)}`}
            >
              Replay latest trace <ArrowUpRight size={14} weight="bold" aria-hidden />
            </Link>
          </div>
          <div className="metrics-grid">
            <Metric
              label="Experiments"
              value={String(experiments.length)}
              detail={published ? "recorded studies" : "local manifests"}
              tone="accent"
            />
            <Metric
              label="Runs"
              value={String(summary.totalRuns)}
              detail={`${summary.resolvedRuns} resolved`}
              tone="steel"
            />
            <Metric
              label="Resolved rate"
              value={`${Math.round(summary.resolvedRate * 100)}%`}
              detail={`${summary.scoredRuns} scored`}
              tone="success"
            />
            <Metric
              label="Latest runtime"
              value={formatDuration(latest.run.totalLatency)}
              detail={latest.run.taskId}
              tone="warning"
            />
          </div>
          {provenance ? (
            <p className="panel-footnote overview-provenance">
              Published snapshot · generated {formatSnapshotDate(provenance.generatedAt)} ·{" "}
              {provenance.runCount ?? "recorded"} allowlisted runs · descriptive evidence, not a
              benchmark claim.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="capability-grid" aria-labelledby="capabilities-title">
        <h2 id="capabilities-title" className="sr-only">
          What MorphScope will let you inspect
        </h2>
        <Panel className="capability-card">
          <div className="capability-icon">
            <TreeStructure size={18} weight="bold" aria-hidden />
          </div>
          <h3>Replay the trace</h3>
          <p>
            Follow search, reads, model calls, edits, commands, and tests in the order they
            happened.
          </p>
        </Panel>
        <Panel className="capability-card">
          <div className="capability-icon">
            <Scales size={18} weight="bold" aria-hidden />
          </div>
          <h3>Compare configurations</h3>
          <p>
            Keep each run intact, then inspect how different search, editing, and context strategies
            diverge.
          </p>
        </Panel>
        <Panel className="capability-card">
          <div className="capability-icon">
            <ChartLineUp size={18} weight="bold" aria-hidden />
          </div>
          <h3>Understand failures</h3>
          <p>
            Separate retrieval, reasoning, editing, application, verification, and environment
            problems.
          </p>
        </Panel>
      </section>

      <section className="setup-section" aria-labelledby="setup-title">
        <Panel className="setup-panel">
          <div className="setup-panel-header">
            <div>
              <p className="eyebrow">
                <span className="eyebrow-marker" aria-hidden />
                First run guidance
              </p>
              <h2 id="setup-title">
                {latest
                  ? "Keep the evidence close to the source."
                  : "Start with a repository and a task definition."}
              </h2>
              <p>
                {latest
                  ? "Every dashboard metric below is derived from persisted run evidence, not presentation fixtures."
                  : "Connect a repository, trace store, and provider before creating the first run."}
              </p>
            </div>
            <Badge variant="steel">
              {published ? "PUBLISHED / READ-ONLY" : "LOCAL / NOT CONNECTED"}
            </Badge>
          </div>
          <div className="setup-code">
            <pre className="ui-code-block" data-language="workspace contract" tabIndex={0}>
              <code>
                repository -&gt; immutable commit -&gt; task definition{"\n"}agent -&gt; trace
                writer -&gt; evaluation result
              </code>
            </pre>
          </div>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-number">01 / DEFINE</span>
              <h3>Describe the task</h3>
              <p>Record the repository, commit, issue, setup, and evaluation command.</p>
            </div>
            <div className="step-card">
              <span className="step-number">02 / RUN</span>
              <h3>Capture the work</h3>
              <p>Run a configuration in isolation and preserve partial trace history.</p>
            </div>
            <div className="step-card">
              <span className="step-number">03 / INSPECT</span>
              <h3>Read the evidence</h3>
              <p>Replay the trace, inspect the patch, and compare terminal outcomes.</p>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function statusFor(state: string): StatusName {
  if (state === "resolved") return "success";
  if (state === "provider_error" || state === "environment_error") return "warning";
  return "failed";
}

function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(2)} s`;
}
