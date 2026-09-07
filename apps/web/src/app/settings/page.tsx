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
import { isPublishedDashboard } from "../../lib/data";

export const metadata = {
  title: "Settings",
  description: "Configure MorphScope workspace display preferences.",
};

export default function SettingsPage() {
  const published = isPublishedDashboard();
  return (
    <div className="empty-page">
      <PageHeader
        eyebrow="Configure / workspace"
        title="Settings"
        description={
          published
            ? "Display preferences are available here. Hosted mode stays read-only and publishes sanitized evidence only."
            : "Display preferences are available now. Data connections and execution settings will be added alongside their real implementations."
        }
      />
      <DevelopmentNotice>
        {published
          ? "Hosted mode is read-only. Provider and runner connections stay in the local CLI."
          : "Only presentation preferences are active. There is no provider, database, or runner connection yet."}
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
                ? "This hosted surface displays sanitized, read-only evidence published with the build."
                : "The shell reads local persisted traces and never creates provider or runner connections from the web UI."}
            </p>
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
                label={published ? "Read-only" : "Local store"}
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
        </div>
      </div>
    </div>
  );
}
