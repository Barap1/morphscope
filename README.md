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

## Current scope: CHECKPOINT 0

The current checkpoint establishes the pnpm TypeScript monorepo metadata, source-of-truth
documentation copies, formatting and linting rules, environment placeholders, and local
workspace verification. Product applications, packages, benchmark runs, traces, and
metrics are intentionally not part of this bootstrap.

No benchmark results or experimental findings are claimed yet. All future results must
come from real repository execution and be accompanied by their methodology and limits.

See [`MorphScope_PRD.md`](MorphScope_PRD.md) and [`MorphScope_spec.md`](MorphScope_spec.md)
for the project requirements and execution specification.
