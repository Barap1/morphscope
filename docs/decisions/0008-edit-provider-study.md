# ADR 0008: Hold retrieval and context fixed in editing studies

Status: accepted

Date: 2026-09-07

## Context

Fast Apply is an editing strategy, so its evaluation must not be confounded by different
repository retrieval or context. MorphScope already has a safe isolated workspace and a
provider boundary from the earlier Morph spike.

## Decision

The `EditProvider` contract accepts one original file, one requested edit, and fixed
instructions. It returns the original and final hashes, the requested edit, merged source
when available, unified diff, syntax status, retry count, apply latency, and provider
metadata. The initial implementations are deterministic replacement, unified-diff
application, full-file replacement, and Morph Fast Apply.

The `edit-study` command reads one controlled source file and applies each strategy in a
fresh isolated workspace with the same task, source commit, instructions, evaluation, and
original-file context. It validates syntax before evaluation, applies only a successful
candidate, runs the task test, and persists sanitized edit metadata with the normal run,
trace, and patch artifacts.

The study defaults to local deterministic strategies. Morph Fast Apply is opt-in through
`--include-fast-apply` so routine development does not consume the free Morph allowance;
the live endpoint contract was already validated by the CP4 controlled spike.

## Consequences

Local editing strategies can be compared repeatedly without provider cost or quota use.
When a live Fast Apply arm is intentionally enabled, its provider/model, usage, latency,
and failures remain attributable in the manifest and trace rather than being silently
substituted by a local implementation.
