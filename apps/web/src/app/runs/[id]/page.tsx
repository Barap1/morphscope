import { ArrowLeft, Clock, GitDiff, Pulse, TreeStructure } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, CodeBlock, LogContainer, Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice, EmptyWorkspace } from "../../../components/empty-page";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="empty-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Run detail</span>
          <h1>{id}</h1>
          <p>
            Trace replay, artifacts, and evaluation state will be attached to this run identity.
          </p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            <ArrowLeft size={15} weight="bold" aria-hidden /> Experiments
          </Link>
          <StatusBadge status="unavailable" label="Not recorded" />
        </div>
      </div>
      <DevelopmentNotice>
        This route keeps <code>{id}</code> navigable while making the absence of a stored trace
        explicit.
      </DevelopmentNotice>
      <div className="detail-grid">
        <Panel className="detail-main-panel">
          <EmptyWorkspace
            icon={<TreeStructure size={21} weight="bold" />}
            eyebrow="No trace recorded"
            title="There is no run evidence to replay."
            description="A real run will populate the span timeline, tool inputs and outputs, test events, patch artifacts, and terminal state here."
          />
        </Panel>
        <div className="detail-side">
          <Panel className="info-panel" tone="steel">
            <span className="section-label">Run identity</span>
            <h2>Execution metadata</h2>
            <dl className="info-list">
              <div className="info-list-row">
                <dt>Trace</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
              <div className="info-list-row">
                <dt>Latency</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
              <div className="info-list-row">
                <dt>Terminal</dt>
                <dd className="unavailable">Unknown</dd>
              </div>
            </dl>
          </Panel>
          <Panel className="info-panel">
            <div className="callout-heading">
              <GitDiff size={16} weight="bold" aria-hidden />
              <span className="section-label">Evidence surfaces</span>
            </div>
            <h2>Trace, patch, evaluation.</h2>
            <p>Nothing is displayed as a result until it comes from execution and persistence.</p>
            <div className="ui-empty-action">
              <Badge variant="steel">
                <Pulse size={13} weight="bold" aria-hidden /> Awaiting trace writer
              </Badge>
            </div>
          </Panel>
        </div>
      </div>
      <Panel className="info-panel" compact>
        <div className="section-heading">
          <div>
            <span className="section-label">Future replay surface</span>
            <h2>Trace channels</h2>
          </div>
          <Clock size={17} weight="bold" aria-hidden />
        </div>
        <LogContainer
          lines={[
            { timestamp: "--:--:--", kind: "info", content: "trace unavailable; no stored spans" },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <CodeBlock language="artifact" code="patch and evaluation artifacts unavailable" />
        </div>
      </Panel>
    </div>
  );
}
