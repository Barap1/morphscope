import {
  ArrowUpRight,
  ChartLineUp,
  PlayCircle,
  Scales,
  TreeStructure,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import Image from "next/image";
import { Badge, Panel, StatusBadge } from "@morphscope/ui";

export default function OverviewPage() {
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
            <Link
              className="ui-button ui-button-secondary ui-button-lg"
              href="/settings#workspace-guide"
            >
              Prepare workspace <ArrowUpRight size={16} weight="bold" aria-hidden />
            </Link>
          </div>
          <div className="hero-annotations">
            <span className="hero-annotations-rule" aria-hidden />
            <span>TRACE / REASON / APPLY / VERIFY</span>
          </div>
        </div>

        <aside className="hero-observatory" aria-label="Workspace status">
          <div className="observatory-header">
            <span className="observatory-label">Workspace status</span>
            <StatusBadge status="unavailable" label="No runs yet" />
          </div>
          <div className="observatory-viewport">
            <div className="observatory-aperture" aria-hidden>
              <span />
              <span />
            </div>
            <div className="observatory-empty-copy">Your first trace will appear here.</div>
          </div>
          <div className="observatory-footer">
            <span>DATA SOURCE</span>
            <strong>Awaiting local trace</strong>
          </div>
        </aside>
      </section>

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
              <h2 id="setup-title">Start with a repository and a task definition.</h2>
              <p>Connect a repository, trace store, and provider before creating the first run.</p>
            </div>
            <Badge variant="steel">LOCAL / NOT CONNECTED</Badge>
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
