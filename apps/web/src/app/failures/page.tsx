import { Bug, Info, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice, EmptyWorkspace } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";

export const metadata = {
  title: "Failures",
  description: "Inspect trace-backed coding-agent failures in MorphScope.",
};

export default function FailuresPage() {
  return (
    <div className="empty-page">
      <PageHeader
        eyebrow="Analyze / failures"
        title="Failures"
        description="Classify where a run stopped working, from retrieval and reasoning through editing, application, verification, or environment."
        actions={<StatusBadge status="unavailable" label="No failures" />}
      />
      <DevelopmentNotice>
        Failure records are created from real run outcomes. This shell does not seed examples or
        fabricate a failure rate.
      </DevelopmentNotice>
      <EmptyWorkspace
        icon={<Bug size={21} weight="bold" />}
        eyebrow="No failure records"
        title="No unsuccessful runs have been captured."
        description="When a run terminates unsuccessfully, this view will retain its category, terminal state, relevant spans, and supporting artifacts."
        action={
          <Link className="ui-button ui-button-secondary" href="/experiments">
            Go to experiments
          </Link>
        }
      />
      <div className="split-grid">
        <Panel className="info-panel" tone="danger">
          <div className="callout-heading">
            <WarningCircle size={16} weight="bold" aria-hidden />
            <span className="section-label">Failure taxonomy</span>
          </div>
          <h2>Keep the cause visible.</h2>
          <p>
            Future records will distinguish a provider error from a test failure and an environment
            problem.
          </p>
        </Panel>
        <Panel className="info-panel" tone="steel">
          <div className="callout-heading">
            <Info size={16} weight="bold" aria-hidden />
            <span className="section-label">Evidence rule</span>
          </div>
          <h2>Every category has a trace.</h2>
          <p>A failure summary will link back to the spans and artifacts that support it.</p>
        </Panel>
      </div>
    </div>
  );
}
