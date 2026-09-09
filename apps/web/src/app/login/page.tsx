import { ArrowLeft, LockKey } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Panel } from "@morphscope/ui";
import { PageHeader } from "../../components/page-header";
import { SignInForm } from "../../components/sign-in-form";
import { workspaceAuthConfigured } from "../../lib/workspace-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace sign in",
  description: "Sign in to manage MorphScope workspace records.",
};

export default function LoginPage() {
  const configured = workspaceAuthConfigured();
  return (
    <div className="empty-page login-page">
      <PageHeader
        eyebrow="Configure / workspace access"
        title="Manage the workspace."
        description="Sign in to create and update experiments, tasks, and run records. Public trace evidence remains available without an account."
        actions={
          <Link className="ui-button ui-button-quiet" href="/settings">
            <ArrowLeft size={15} weight="bold" aria-hidden /> Back to settings
          </Link>
        }
      />
      <Panel className="login-panel" tone="steel">
        <div className="callout-heading">
          <LockKey size={16} weight="bold" aria-hidden />
          <span className="section-label">Authenticated workspace</span>
        </div>
        <h2>Sign in to edit records</h2>
        {configured ? (
          <SignInForm />
        ) : (
          <div className="login-unconfigured">
            <p>
              Workspace access is not configured on this deployment yet. Add a Postgres connection,
              session secret, and scrypt password hash to enable it.
            </p>
            <code className="ui-code-block">
              DATABASE_URL + MORPHSCOPE_SESSION_SECRET + MORPHSCOPE_WORKSPACE_PASSWORD_HASH
            </code>
            <p className="panel-footnote">
              See the deployment section in the README for the setup command. No provider keys are
              required for workspace CRUD.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
