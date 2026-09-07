# ADR 0007: Compare persisted traces by aligned spans

Status: accepted

Date: 2026-09-07

## Context

MorphScope needs a controlled way to inspect two configurations on the same task. A
comparison that only places aggregate scores beside one another hides the retrieval and
editing decisions that can explain a downstream difference.

## Decision

The `/compare` route selects two persisted runs through linkable `left` and `right` query
parameters. When no pair is selected, it chooses a pair from the same task and prefers a
resolved baseline plus a resolved WarpGrep run when those configurations exist.

Comparisons are blocked when task identities differ unless the user explicitly enables
the `allowDifferentTask=1` diagnostic override. Span timelines are aligned by type with
a small look-ahead for inserted provider/tool spans. Rows that are missing, reordered, or
have different statuses are marked as divergent. The interface also shows the measured
latency/token/cost/patch deltas, retrieval/edit evidence, technical span attributes,
side-by-side patch artifacts, and validation outcomes.

The comparison renders stored evidence and measured deltas only. It does not infer that
one configuration caused a result, and it does not substitute a model or provider when a
selected run is rate-limited or failed.

## Consequences

The baseline and WarpGrep traces for the fixture task can be opened together and their
first span-level divergence is visible without editing fixture data. The alignment is
intentionally small and deterministic; richer event semantics can be added when later
editing and context experiments persist more structured events.
