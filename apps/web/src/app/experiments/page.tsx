import { Flask, Plus, SlidersHorizontal } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Badge, Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice, EmptyWorkspace, UnavailablePanel } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";

export default function ExperimentsPage() {
  return (
    <div className="empty-page">
      <PageHeader
        eyebrow="Observe / experiments"
        title="Experiments"
        description="Define a controlled evaluation, keep its runs intact, and inspect the evidence when the runner is connected."
        actions={
          <Link className="ui-button ui-button-secondary" href="/settings#workspace-guide">
            <Plus size={15} weight="bold" aria-hidden /> Setup guide
          </Link>
        }
      />
      <DevelopmentNotice>
        Experiment records are not connected in this shell. No runs or results are being implied.
      </DevelopmentNotice>
      <div className="empty-page-grid">
        <EmptyWorkspace
          icon={<Flask size={21} weight="bold" />}
          eyebrow="No experiment definitions"
          title="Your experiment queue is empty."
          description="Once the data layer is available, this view will list task sets, configuration matrices, and the runs they produce."
          action={
            <Link className="ui-button ui-button-primary" href="/settings#workspace-guide">
              Review workspace setup
            </Link>
          }
        />
        <div className="empty-page-side">
          <UnavailablePanel
            title="No task set loaded"
            description="A task set needs an immutable repository commit, task instructions, setup, and evaluation details before a run can be created."
          />
          <Panel className="info-panel">
            <div className="section-heading">
              <div>
                <span className="section-label">Configuration matrix</span>
                <h2>What this screen will expose</h2>
              </div>
              <SlidersHorizontal size={17} weight="bold" aria-hidden />
            </div>
            <dl className="info-list">
              <div className="info-list-row">
                <dt>Search</dt>
                <dd>
                  <Badge variant="steel">Baseline / WarpGrep</Badge>
                </dd>
              </div>
              <div className="info-list-row">
                <dt>Edit</dt>
                <dd>
                  <Badge variant="accent">Deterministic / Fast Apply</Badge>
                </dd>
              </div>
              <div className="info-list-row">
                <dt>Context</dt>
                <dd>
                  <StatusBadge status="unavailable" label="Not connected" />
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
