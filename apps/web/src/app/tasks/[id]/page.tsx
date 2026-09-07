import { ArrowLeft, ClipboardText, FileCode, GitBranch } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice, EmptyWorkspace } from "../../../components/empty-page";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="empty-page">
      <div className="detail-heading">
        <div className="detail-heading-copy">
          <span className="detail-label">Task detail</span>
          <h1>{id}</h1>
          <p>A task record can anchor a reproducible run once the task schema is connected.</p>
        </div>
        <div className="detail-heading-actions">
          <Link className="ui-button ui-button-quiet" href="/experiments">
            <ArrowLeft size={15} weight="bold" aria-hidden /> Experiments
          </Link>
          <StatusBadge status="unavailable" label="Not loaded" />
        </div>
      </div>
      <DevelopmentNotice>
        This route renders an identified placeholder for <code>{id}</code>. It does not claim
        repository or evaluation data.
      </DevelopmentNotice>
      <div className="detail-grid">
        <Panel className="detail-main-panel">
          <EmptyWorkspace
            icon={<ClipboardText size={21} weight="bold" />}
            eyebrow="Task definition unavailable"
            title="No task has been loaded."
            description="A connected task will show its issue, repository commit, setup instructions, evaluation command, limits, and tags."
          />
        </Panel>
        <div className="detail-side">
          <Panel className="info-panel">
            <span className="section-label">Expected inputs</span>
            <h2>Reproducibility fields</h2>
            <dl className="info-list">
              <div className="info-list-row">
                <dt>Repository</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
              <div className="info-list-row">
                <dt>Commit</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
              <div className="info-list-row">
                <dt>Evaluation</dt>
                <dd className="unavailable">Unavailable</dd>
              </div>
            </dl>
          </Panel>
          <Panel className="info-panel" tone="steel">
            <div className="callout-heading">
              <GitBranch size={16} weight="bold" aria-hidden />
              <span className="section-label">Task contract</span>
            </div>
            <h2>Immutable source first.</h2>
            <p>
              Every future run will identify the repository and exact commit before execution
              begins.
            </p>
            <div className="ui-empty-action">
              <Badge variant="steel">
                <FileCode size={13} weight="bold" aria-hidden /> Schema pending
              </Badge>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
