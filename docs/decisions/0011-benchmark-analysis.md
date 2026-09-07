# ADR 0011: Keep the initial benchmark analysis small and descriptive

## Status

Accepted for Checkpoint 12.

## Decision

MorphScope starts with a development-sized catalog: the existing JavaScript fixture, a
TypeScript fixture, a Python fixture, and one explicitly catalog-only real-repository entry.
Each runnable task records language, repository type, task shape, change shape, and a pinned
task file. The catalog is metadata, not a claim that every listed task has been benchmarked.

The analysis command reads persisted `run.json` artifacts and calculates raw terminal counts,
descriptive medians and percentile ranges, per-configuration rates, and task-aligned paired
deltas. Bootstrap latency intervals use a deterministic seed and are emitted only when at least
ten paired observations exist. Small development samples therefore remain visibly descriptive;
the report does not imply statistical significance.

## Consequences

- New language and task-shape coverage can be added without silently mixing incomparable runs.
- Routine analysis is offline and consumes only persisted local artifacts.
- Publication-sized repetition remains a later deliberate activity rather than an accidental
  quota-consuming default.
