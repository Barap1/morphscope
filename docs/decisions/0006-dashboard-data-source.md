# ADR 0006: The dashboard reads persisted local evidence

Status: accepted

Date: 2026-09-07

## Context

The first web shell used fixture-shaped presentation data while the runner, trace store,
evaluator, and patch artifacts were being built. Checkpoint 7 requires the dashboard to
show actual experiments and runs, including a newly completed CLI run, without a manual
data-editing step.

## Decision

The Next.js dashboard reads the local `.morphscope` directory on each dynamic request.
It discovers persisted `run.json` and experiment manifests, validates run payloads with
the shared schemas, and joins trace spans, evaluation output, search measurements, and
content-addressed patch artifacts by their recorded identifiers and paths.

The loader is deliberately read-only and bounded:

- malformed or incomplete records are skipped rather than presented as evidence;
- file reads are limited to the local workspace, known artifact paths, and an 8 MB
  per-file cap;
- provider response bodies are not introduced into the dashboard;
- empty states say that evidence is unavailable instead of fabricating metrics;
- the root shell receives its status from the same latest-run data as the pages.

## Consequences

The overview, experiment, task, failure, and run-replay routes are real views over the
local trace store. A fresh CLI run becomes visible after a reload without editing React
fixtures. The current implementation is intentionally local and read-only; a hosted
dashboard or remote store remains a later deployment checkpoint.
