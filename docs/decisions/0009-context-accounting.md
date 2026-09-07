# ADR 0009: Measure context before adding adaptive compaction

## Status

Accepted for Checkpoint 10.

## Decision

MorphScope records context accounting as a first-class evaluation signal before introducing
adaptive rules. The controlled study compares an unchanged context, deterministic byte-based
threshold truncation, and an opt-in Morph Compact arm behind one shared provider contract.

Each profile records context bytes and message/line counts before and after the operation,
tool-output share, retained ratio, retained source bytes, information-loss classification,
estimated future input savings, estimated model calls saved at a fixed context limit, latency,
cost metadata, and downstream marker success. The study also persists redacted before/after
snapshots and `context_profile` trace events so a result can be replayed from the local store.

The default run is fully local and uses a realistic synthetic repository-agent context. The
Morph arm is explicitly opt-in and performs one final-context call rather than a matrix of live
calls. This preserves free-tier allowance while still allowing a deliberate live comparison.
Morph Compact output is treated as information-loss `unmeasured` unless the study can prove
which source bytes survived; local truncation reports an estimated loss instead of pretending
to know semantic loss.

## Consequences

- Context size and tool-output growth are visible before adaptive policy work begins.
- Local results are deterministic and routine CI does not need Morph credentials.
- “Future model-call savings” is an estimate under the recorded fixed byte limit, not a claim
  about provider billing or actual avoided calls.
- Morph Compact usage, nominal cost metadata, latency, and model identity remain traceable when
  the optional live arm is run.
