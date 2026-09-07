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

## Current scope: CHECKPOINT 3

The current vertical slice adds shared schemas, incremental redacted traces, durable
SQLite persistence, content-addressed patch artifacts, an isolated local sandbox, and a
deterministic offline baseline runner. The web shell remains honest about the fact that
dashboard pages are not yet connected to these persisted runs.

To work on the web shell:

```bash
pnpm dev:web
pnpm build:web
```

The shell can be inspected locally; the CP3 runner is exercised through the CLI while
dashboard integration remains a later checkpoint.

To run the real TypeScript fixture from a clean disposable workspace:

```bash
pnpm morphscope run benchmarks/tasks/example.yaml --config baseline
```

The command writes a structured `run.json`, SQLite trace, and content-addressed Git diff
under `.morphscope/runs/<run-id>/`. The baseline is intentionally deterministic and
offline for this checkpoint; it exercises real search, read, edit, setup, and evaluation
commands without claiming model-provider results.

The Morph technical-spike boundary is implemented but live validation is credential-gated.
After setting `MORPH_API_KEY` in local environment configuration, run:

```bash
pnpm morphscope:morph-spike \
  --file benchmarks/fixtures/buggy-greeting/src/greeting.js \
  --search formatGreeting \
  --instructions "Add punctuation to the greeting" \
  --code-edit '// ... existing code ... return `Hello ${name}!`; // ... existing code ...'
```

The spike records provider metadata, trace spans, hashes, diff, and compacted context under
`.morphscope/morph-spike/`. No live provider result is claimed until that command completes
with a real credential.

No benchmark results or experimental findings are claimed yet. All future results must
come from real repository execution and be accompanied by their methodology and limits.

See [`MorphScope_PRD.md`](MorphScope_PRD.md) and [`MorphScope_spec.md`](MorphScope_spec.md)
for the project requirements and execution specification.
