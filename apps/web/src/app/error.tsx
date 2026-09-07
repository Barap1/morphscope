"use client";

import { ArrowCounterClockwise, WarningCircle } from "@phosphor-icons/react";
import { ErrorState, Button } from "@morphscope/ui";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-page">
      <h1 className="sr-only">Workspace error</h1>
      <ErrorState
        title="The workspace view stopped"
        description="The shell could not render this view. Try the route again. If the problem persists, inspect the local development log."
        action={
          <Button variant="secondary" onClick={reset}>
            <ArrowCounterClockwise size={15} weight="bold" aria-hidden /> Try again
          </Button>
        }
      />
      <p className="error-page-note">
        <WarningCircle size={14} weight="bold" aria-hidden /> No run data was changed by this UI
        error.
      </p>
    </div>
  );
}
