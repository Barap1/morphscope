# ADR 0010: Use transparent rule-based adaptive routing first

## Status

Accepted for Checkpoint 11.

## Decision

MorphScope uses `adaptive-rules-v1` as the first adaptive controller. It makes explicit,
auditable decisions for search, editing, and context compaction. Each decision persists the
feature values, selected route, policy version, and human-readable reason in the run artifact
and as a trace span/event.

The policy keeps small exact lookups on local search, small anchored edits on deterministic
editing, and contexts below the fixed byte trigger uncompressed. It selects WarpGrep, Fast
Apply, or Morph Compact only when their feature rules indicate a need and the corresponding
provider is explicitly available. The local fixture therefore exercises the complete routing
and evaluation path without silently consuming provider quota.

Adaptive execution reuses the existing experiment runner, isolated workspace, trace writer,
content-addressed diff artifact, evaluator, and web replay route. The controller does not
learn from the current run and does not hide fallback behavior behind an opaque score.

## Consequences

- Reviewers can explain every route from persisted evidence rather than inferred behavior.
- Rules can be tested deterministically and changed under a versioned policy identifier.
- Provider availability is an explicit feature, so a free-tier constraint cannot silently turn
  into an incomparable provider substitution.
- The rules are intentionally a starting point; later studies can compare policy versions or
  replace them with a more sophisticated controller without changing run persistence.
