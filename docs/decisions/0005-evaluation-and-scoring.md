# ADR 0005: Conservative evaluation and failure scoring

## Status

Accepted for Checkpoint 6.

## Decision

The evaluator records patch statistics, optional syntax/build/repository-native validation
commands, the task-specific evaluation command, out-of-scope changed files, and structured
failure evidence. Validation commands are supplied by task metadata or the evaluator
caller; the task command remains the required final check.

Automatic classification follows a fixed priority and remains conservative. Environment
and provider failures are kept separate from verification, regression, and agent-action
categories. A failed environment produces a `null` score, so it cannot reduce correctness
rates as if an agent had produced an incorrect patch. Manual reviewers can add a
timestamped correction in `analysisMetadata.manualCorrection` while the automatic result
remains available for audit.

Aggregations report resolved rate, correctness over scored runs only, runtime/cost/token
summaries, per-configuration results, and failure-category counts. These summaries are
derived from persisted runs and do not embed benchmark conclusions.
