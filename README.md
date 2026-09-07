# MorphScope

MorphScope is an open-source coding-agent evaluation, profiling, trace-replay, and
adaptive-routing platform. It is under active development, and this repository remains
private during implementation.

## Prerequisites

- Node.js `>=24 <25`
- pnpm `11.25.0`

## Bootstrap

From the repository root:

```bash
pnpm install
pnpm workspace:verify
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

`pnpm install` uses the versions declared in the root manifest. Provider credentials are
optional during bootstrap; see `.env.example` before running provider-backed experiments.

## Current scope: CHECKPOINT 15

The current vertical slice adds shared schemas, incremental redacted traces, durable
SQLite persistence, content-addressed patch artifacts, an isolated local sandbox, a
deterministic offline baseline runner, and credential-gated provider adapters. Morph
WarpGrep, Fast Apply, and Compact use the documented OpenAI-compatible HTTP contracts.
Groq is the reasoning provider with `openai/gpt-oss-120b` as the explicit default.
Provider metadata records model identity, status, latency, usage when supplied, and
classified provider failures. Live provider artifacts stay under the ignored
`.morphscope/` directory.

To work on the web shell:

```bash
pnpm dev:web
pnpm build:web
```

The web dashboard now reads persisted `.morphscope` run, experiment, trace, evaluation,
and patch artifacts directly. It is dynamically rendered, so a newly completed local
CLI run appears on the overview, experiment, task, failure, and run-replay views without
hand-authored dashboard fixtures:

```bash
pnpm dev:web
```

Use the overview for the current evidence field, `/experiments` for configuration
matrices and recorded outcomes, `/tasks/<task-id>` for task-scoped runs, and
`/runs/<run-id>` for replayable trace, validation, and patch evidence. Empty states stay
explicit when the local trace store has no records. The `/compare` route selects two
persisted runs, constrains them to the same task by default, and shows aligned timelines,
first-divergence markers, measured deltas, technical span details, patches, and
verification outcomes. The experiment detail page links directly into a recorded pair.

The controlled editing study is available offline by default:

```bash
pnpm morphscope experiment run edit-study
```

It keeps the original file and evaluation fixed while comparing deterministic, unified-diff,
and full-file editing. Use `--include-fast-apply` only when a deliberate live Morph call is
warranted; the Fast Apply endpoint itself was already accepted during CP4.

Context accounting and Compact evaluation are also available offline by default:

```bash
pnpm morphscope experiment run context-study
```

This records context size over time, tool-output share, retained ratio, estimated future
model-call savings, information-loss classification, downstream marker success, latency,
cost, and replayable before/after context snapshots. The local arms compare no compaction
with threshold truncation. Use `--include-compact` for one deliberate live Morph Compact
call; it is final-context-only to preserve the free allowance. Provider output is redacted
at the persistence boundary and the synthetic context contains no credentials or prompt text.

To run the real TypeScript fixture from a clean disposable workspace:

```bash
pnpm morphscope run benchmarks/tasks/example.yaml --config baseline
```

The command writes a structured `run.json`, SQLite trace, and content-addressed Git diff
under `.morphscope/runs/<run-id>/`. The baseline is intentionally deterministic and
offline for the local baseline path; it exercises real search, read, edit, setup, and evaluation
commands without claiming model-provider results.

The auditable adaptive controller runs through the same fixture, sandbox, evaluation, and
trace path:

```bash
pnpm morphscope experiment run adaptive-study
```

`adaptive-rules-v1` persists search, edit, and compaction features, selected routes, policy
version, and reasons in the run artifact and UI. The default fixture stays local and selects
raw search, deterministic editing, and no compaction; use `--include-morph` only for a
deliberate provider-backed route when the decision features select one.

The development benchmark catalog is in `benchmarks/tasks/catalog.json` and currently covers
JavaScript, TypeScript, and Python controlled fixtures plus a clearly marked catalog-only
real-repository task. Run the descriptive analysis over persisted artifacts with:

```bash
pnpm morphscope analysis --input .morphscope --output analysis/output/results.json
```

The report contains raw counts, medians, percentile ranges, task-aligned paired deltas, and
deterministic bootstrap intervals only when at least ten paired observations exist. Small local
samples remain explicitly descriptive.

The developer workflow is now inspectable from the CLI as well as the dashboard:

```bash
pnpm morphscope task list
pnpm morphscope task validate benchmarks/tasks/example.yaml
pnpm morphscope experiment list --filter adaptive
pnpm morphscope experiment resume <experiment-id>
pnpm morphscope trace export <run-id> --output /private/tmp/run-trace.json
pnpm morphscope results export --format csv --output /private/tmp/results.csv
pnpm morphscope artifact list <run-id>
```

`experiment resume` is deliberately idempotent: a completed manifest reports that its linked
runs are already present and does not create duplicates. Run output directories cannot overwrite
an existing persisted `run.json`. `run` emits progress on stderr, records an interrupted run as
`cancelled`, and keeps the trace and patch evidence available for inspection. The web ledger accepts
`/experiments?q=<term>` for persisted-data filtering, while `/runs/<run-id>` and the equivalent
`/share/runs/<run-id>` route are read-only, shareable evidence views. Run pages include copyable IDs
and trace-export commands.

### Adding a task

Add a task definition under `benchmarks/tasks/` and a versioned baseline plan under
`benchmarks/tasks/` or `benchmarks/fixtures/`. The task must point at a repository, commit,
setup/evaluation metadata, resource limits, and `metadata.baselinePlan`. Validate it before running:

```bash
pnpm morphscope task validate benchmarks/tasks/my-task.yaml
pnpm morphscope run benchmarks/tasks/my-task.yaml --config baseline
```

Keep the fixture deterministic and small enough for routine local runs. Add the task to
`benchmarks/tasks/catalog.json` with its language, provenance, and whether it is runnable locally;
do not describe a catalog-only repository as executed evidence.

### Adding a provider

Implement the existing provider interface in `packages/providers/src/`, keep credentials in an
ignored local environment file, and record provider/model identity plus latency, status, usage, and
classified failures in the provider result. Add a deterministic mock test before one deliberate
live smoke test. Use `GROQ_API_KEY` with `openai/gpt-oss-120b` for reasoning in the current free-tier
development path; Morph credentials are only for the specialized WarpGrep, Fast Apply, and Compact
spikes. Do not send one provider's credential to another provider, persist raw provider responses,
or silently substitute a model in a controlled comparison.

The security fixture is intentionally small and offline:

```bash
pnpm morphscope task validate benchmarks/tasks/adversarial-sandbox.yaml
pnpm morphscope run benchmarks/tasks/adversarial-sandbox.yaml --config baseline
```

The sandbox rejects workspace path escapes and patch traversal before application, copies only a
sanitized child environment, caps captured output, enforces command timeouts, and refuses symlink
reads that resolve outside the workspace. Trace, artifact, and web readers reject symlink-backed
files, and provider/spike error artifacts redact known credential formats. The local runner is a
developer-mode process boundary rather than a claim of kernel-level isolation; do not execute
untrusted repositories with host credentials or broaden the command allowlist without adding an OS
or container enforcement layer.

Pull requests and pushes to `main` run the proportional GitHub Actions workflow in
`.github/workflows/ci.yml`. It installs from the frozen lockfile, verifies the workspace, runs
typecheck/lint/tests/format checks, executes one offline fixture and the descriptive analysis
pipeline, and builds the web application. It never invokes Morph, Groq, OpenAI, or another external
provider. Provider tests use deterministic mocked transports; live provider checks remain explicitly
local/manual and consume no CI quota.

The Morph technical-spike boundary is implemented and live validation is credential-gated.
After setting `MORPH_API_KEY` in local environment configuration, run:

```bash
pnpm morphscope:morph-spike \
  --file benchmarks/fixtures/buggy-greeting/src/greeting.js \
  --search formatGreeting \
  --instructions "Add punctuation to the greeting" \
  --code-edit '// ... existing code ... return `Hello ${name}!`; // ... existing code ...'
```

The spike records provider metadata, trace spans, hashes, diff, and compacted context under
`.morphscope/morph-spike/`. Use `--only warpgrep`, `--only fast-apply`, or `--only compact`
for a single controlled capability check. A WarpGrep result records whether contexts came
from the provider finish payload or an actual local read fallback when the provider omits a
usable final payload.

For the reasoning provider smoke:

```bash
pnpm morphscope:groq-smoke
```

The smoke records only provider/model identity, status, latency, usage, rate-limit metadata,
and a response hash; it does not persist the provider response text.

No benchmark results or experimental findings are claimed yet. All future results must
come from real repository execution and be accompanied by their methodology and limits.

The first controlled search study is available through:

```bash
pnpm morphscope experiment run search-study
```

It runs the same fixture task twice in isolated workspaces, varying only the search
provider between local raw search and Morph WarpGrep. The baseline plan is intentionally
deterministic for this checkpoint, so the study measures search differences without
silently changing the editing strategy or inventing model outcomes. Each arm persists a
run trace, patch artifact, search-context artifact, provider metadata, and measurement
manifest under `.morphscope/experiments/search-study/<experiment-id>/`.

Completed runs also persist evaluator analysis: patch statistics, validation results,
out-of-scope file detection, automatic failure classification, and optional manual
correction metadata. Environment failures receive no correctness score, so they are not
counted as incorrect agent solutions during aggregation.

See [`MorphScope_PRD.md`](MorphScope_PRD.md) and [`MorphScope_spec.md`](MorphScope_spec.md)
for the project requirements and execution specification.
