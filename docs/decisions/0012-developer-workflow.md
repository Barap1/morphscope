# ADR 0012: Product-quality developer workflow

## Status

Accepted for Checkpoint 13.

## Decision

MorphScope exposes a small, evidence-oriented CLI for validating task definitions, listing and
resuming experiment manifests, exporting traces and results, and browsing content-addressed run
artifacts. The web application remains read-only over persisted `.morphscope` data and provides
query-filtered experiment evidence plus shareable run routes.

The runner refuses to overwrite an output directory that already contains `run.json`, emits
human-readable progress on stderr, and converts an interrupt observed at a safe agent boundary into
the `cancelled` terminal state. Resume is an idempotence check: a completed manifest with all linked
runs present is reported as complete without starting another run.

Exports validate persisted runs against the shared schema and expose only structured run/trace data
or bounded result columns. Raw provider responses and credentials are not part of the export
surface. Task and provider extension guidance lives in the repository README so new contributors
can follow the same deterministic-fixture and mock-first workflow.

## Consequences

- Common inspection tasks are reproducible from shell commands and can be linked to persisted IDs.
- Partial manifests are visible and actionable without pretending that missing runs succeeded.
- The dashboard can be shared for review without introducing a write path.
- Provider integrations remain behind the existing abstraction and must preserve metadata and secret
  boundaries.
