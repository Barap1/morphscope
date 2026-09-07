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

## Current scope: CHECKPOINT 1

The current checkpoint establishes the MorphScope web shell, responsive navigation,
command menu, theme support, visual tokens, and reusable UI primitives. It includes
honest empty states for the initial routes. Runner, persistence, provider integrations,
traces, benchmark runs, and metrics are intentionally not part of this checkpoint.

To work on the web shell:

```bash
pnpm dev:web
pnpm build:web
```

The shell can be inspected locally, but it does not claim that future execution or
trace-backed capabilities are connected yet.

No benchmark results or experimental findings are claimed yet. All future results must
come from real repository execution and be accompanied by their methodology and limits.

See [`MorphScope_PRD.md`](MorphScope_PRD.md) and [`MorphScope_spec.md`](MorphScope_spec.md)
for the project requirements and execution specification.
