import { ArrowLeft, Compass } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { EmptyState } from "@morphscope/ui";

export default function NotFound() {
  return (
    <div className="error-page">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<Compass size={21} weight="bold" />}
        eyebrow="404 / route not found"
        title="This workspace path is not defined."
        description="Return to the overview or use the command menu to choose a known MorphScope view."
        action={
          <Link className="ui-button ui-button-secondary" href="/">
            <ArrowLeft size={15} weight="bold" aria-hidden /> Back to overview
          </Link>
        }
      />
    </div>
  );
}
