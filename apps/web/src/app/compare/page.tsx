import { GitDiff, Info, Scales } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice } from "../../components/empty-page";

export const metadata = {
  title: "Compare",
  description: "Compare trace-backed MorphScope configurations side by side.",
};

export default function ComparePage() {
  return (
    <div className="empty-page">
      <div className="compare-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-marker" aria-hidden />
            Analyze / comparison
          </p>
          <h1>Compare the evidence.</h1>
          <p>Place two recorded runs side by side when the workspace has trace data to compare.</p>
        </div>
        <StatusBadge status="unavailable" label="No runs available" />
      </div>
      <DevelopmentNotice>
        Comparison stays empty until both sides originate from stored runs. No performance
        conclusion is shown here.
      </DevelopmentNotice>
      <div className="compare-grid" role="group" aria-label="Comparison slots">
        <ComparePanel
          tone="baseline"
          icon={<Scales size={19} weight="bold" />}
          label="Configuration A"
          title="Baseline"
          description="Standard repository tools and the selected reasoning model."
        />
        <ComparePanel
          tone="morph"
          icon={<GitDiff size={19} weight="bold" />}
          label="Configuration B"
          title="Morph pipeline"
          description="Specialized search, editing, or context tooling when configured."
        />
      </div>
      <Panel className="info-panel" tone="steel">
        <div className="callout-heading">
          <Info size={16} weight="bold" aria-hidden />
          <span className="section-label">Comparison contract</span>
        </div>
        <h2>Same task, inspectable difference.</h2>
        <p>
          Future comparisons will preserve task identity, repository commit, configuration, terminal
          state, and trace artifacts for both runs.
        </p>
        <div className="ui-empty-action">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            Browse experiments
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function ComparePanel({
  tone,
  icon,
  label,
  title,
  description,
}: {
  tone: "baseline" | "morph";
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <Panel className={`compare-panel compare-panel-${tone}`}>
      <div className="compare-label-row">
        <span className="compare-label">{label}</span>
        <span className="capability-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="compare-placeholder">
        <span>No run selected. Recorded trace data will render in this slot.</span>
      </div>
    </Panel>
  );
}
