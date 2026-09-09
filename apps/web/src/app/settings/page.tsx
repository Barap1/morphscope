import {
  Check,
  CircleHalf,
  Database,
  Info,
  Keyboard,
  Palette,
  ShieldCheck,
} from "@phosphor-icons/react/ssr";
import { Badge, Panel, StatusBadge } from "@morphscope/ui";
import { DevelopmentNotice } from "../../components/empty-page";
import { PageHeader } from "../../components/page-header";
import { ThemeToggle } from "../../components/theme-toggle";
import { WorkspaceDataManager } from "../../components/workspace-data-manager";
import { isPublishedDashboard, loadPublishedProvenance } from "../../lib/data";
import { hasWorkspaceSession, workspaceAuthConfigured } from "../../lib/workspace-auth";
import Link from "next/link";

export const metadata = {
  title: "Settings",
  description: "Configure MorphScope workspace display preferences.",
};

export default async function SettingsPage() {
  const published = isPublishedDashboard();
  const provenance = published ? loadPublishedProvenance() : null;
  const accessConfigured = workspaceAuthConfigured();
  const authenticated = accessConfigured && (await hasWorkspaceSession());
  return (
    <div className="empty-page">
      <PageHeader
        eyebrow="Configure / workspace"
        title="Settings"
        description={
          published
            ? "Display preferences and authenticated workspace data are available here. Public trace evidence remains snapshot-backed."
            : "Display preferences are available now. Local traces remain the source of truth for execution evidence."
        }
      />
      <DevelopmentNotice>
        {authenticated
          ? "Workspace access is enabled. You can manage records below; provider and runner connections stay in the local CLI."
          : accessConfigured
            ? "Sign in to manage workspace records. Provider and runner connections stay in the local CLI."
            : "Only presentation preferences are active until workspace storage and access are configured."}
      </DevelopmentNotice>
      <div className="settings-grid">
        <Panel className="settings-panel" id="workspace-guide">
          <div className="callout-heading">
            <Palette size={16} weight="bold" aria-hidden />
            <span className="section-label">Display</span>
          </div>
          <h2>Workspace preferences</h2>
          <p>
            Choose a comfortable surface for reading traces, code, and dense experiment details.
          </p>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>Color theme</strong>
              <span>
                Dark is the primary MorphScope surface. Your choice is saved in this browser.
              </span>
            </div>
            <div className="settings-chip">
              <ThemeToggle />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>Motion</strong>
              <span>System reduced-motion preferences are respected across the shell.</span>
            </div>
            <div className="settings-chip">
              <Badge variant="steel">
                <CircleHalf size={13} weight="bold" aria-hidden /> System
              </Badge>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>Density</strong>
              <span>Instrument panels use compact spacing for code and trace review.</span>
            </div>
            <div className="settings-chip">
              <Badge variant="neutral">Compact</Badge>
            </div>
          </div>
        </Panel>

        <div className="empty-page-side">
          <Panel className="settings-panel" tone="steel">
            <div className="callout-heading">
              <Database size={16} weight="bold" aria-hidden />
              <span className="section-label">Data source</span>
            </div>
            <h2>{published ? "Published snapshot" : "Local traces only"}</h2>
            <p>
              {published
                ? "Public pages display sanitized evidence published with the build. Authenticated workspace records are stored separately and never execute repositories."
                : "The shell reads local persisted traces and never creates provider or runner connections from the web UI."}
            </p>
            {provenance ? (
              <p className="panel-footnote">
                Generated {formatSnapshotDate(provenance.generatedAt)} from{" "}
                {provenance.runCount ?? "recorded"} allowlisted runs at source commit{" "}
                <code>{provenance.sourceCommit.slice(0, 8)}</code>.
              </p>
            ) : null}
            <div className="settings-guide">
              <div className="settings-guide-item">
                <ShieldCheck size={16} weight="bold" aria-hidden />
                <div>
                  <strong>
                    {published ? "Sanitized publication" : "Redaction before persistence"}
                  </strong>
                  <span>
                    {published
                      ? "Provider responses and credentials are not part of the hosted snapshot."
                      : "Secrets and provider payloads are redacted before local persistence."}
                  </span>
                </div>
              </div>
              <div className="settings-guide-item">
                <Info size={16} weight="bold" aria-hidden />
                <div>
                  <strong>Evidence over decoration</strong>
                  <span>Displayed metrics will be unavailable until backed by an actual run.</span>
                </div>
              </div>
            </div>
            <div className="ui-empty-action">
              <StatusBadge
                status={published ? "ready" : "unavailable"}
                label={published ? "Public snapshot" : "Local store"}
              />
            </div>
          </Panel>
          <Panel className="settings-panel">
            <div className="callout-heading">
              <Keyboard size={16} weight="bold" aria-hidden />
              <span className="section-label">Keyboard</span>
            </div>
            <h2>Command menu</h2>
            <p>
              Press <kbd className="kbd">⌘K</kbd> or <kbd className="kbd">Ctrl K</kbd> to navigate
              views, then use arrow keys and Enter.
            </p>
            <div className="ui-empty-action">
              <Badge variant="accent">
                <Check size={13} weight="bold" aria-hidden /> Ready in shell
              </Badge>
            </div>
          </Panel>

          <Panel className="settings-panel" tone="accent">
            <div className="callout-heading">
              <ShieldCheck size={16} weight="bold" aria-hidden />
              <span className="section-label">Workspace access</span>
            </div>
            <h2>{authenticated ? "Editing is enabled" : "Private record management"}</h2>
            <p>
              {authenticated
                ? "Manage experiments, task contracts, and planned or manually recorded runs in the authenticated workspace."
                : accessConfigured
                  ? "Sign in with the workspace credential to create and edit private records."
                  : "Configure Postgres, a session secret, and a password hash to turn on authenticated record management."}
            </p>
            {authenticated ? <WorkspaceDataManager /> : null}
            {!authenticated && accessConfigured ? (
              <Link className="ui-button ui-button-primary ui-button-sm" href="/login">
                Sign in to edit
              </Link>
            ) : null}
            {!authenticated && !accessConfigured ? (
              <p className="panel-footnote">
                Required variables: <code>DATABASE_URL</code>,{" "}
                <code>MORPHSCOPE_SESSION_SECRET</code>, and{" "}
                <code>MORPHSCOPE_WORKSPACE_PASSWORD_HASH</code>.
              </p>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
