import { ArrowLeft, Flask, LinkSimple } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice, EmptyWorkspace } from "../../../components/empty-page";

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="empty-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Experiment detail</span>
          <h1>{id}</h1>
          <p>No stored experiment record was loaded for this identifier.</p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            <ArrowLeft size={15} weight="bold" aria-hidden /> All experiments
          </Link>
          <StatusBadge status="unavailable" label="No runs" />
        </div>
      </div>
      <DevelopmentNotice>
        This route shows the requested identifier <code>{id}</code>, not a persisted experiment.
      </DevelopmentNotice>
      <div className="detail-grid">
        <Panel className="detail-main-panel">
          <EmptyWorkspace
            icon={<Flask size={21} weight="bold" />}
            eyebrow="Awaiting first run"
            title="There is no trace to replay."
            description="When this experiment runs, its task set, configuration decisions, trace timeline, artifacts, and evaluation outcome will be shown here."
          />
        </Panel>
        <div className="detail-side">
          <Panel className="info-panel" tone="steel">
            <span className="section-label">Identity</span>
            <h2>Experiment record</h2>
            <dl className="info-list">
              <div className="info-list-row">
                <dt>ID</dt>
                <dd>{id}</dd>
              </div>
              <div className="info-list-row">
                <dt>Status</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
              <div className="info-list-row">
                <dt>Trace</dt>
                <dd className="unavailable">Not recorded</dd>
              </div>
            </dl>
          </Panel>
          <Panel className="info-panel">
            <div className="callout-heading">
              <LinkSimple size={16} weight="bold" aria-hidden />
              <span className="section-label">Next connection</span>
            </div>
            <h2>Run data stays inspectable.</h2>
            <p>
              The UI will link every displayed outcome back to the stored trace and repository
              artifact.
            </p>
            <div className="ui-empty-action">
              <Badge variant="steel">TRACE-BACKED BY DESIGN</Badge>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
