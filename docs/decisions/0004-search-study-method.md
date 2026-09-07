# ADR 0004: Controlled raw-search versus WarpGrep study

## Status

Accepted for Checkpoint 5.

## Decision

MorphScope exposes a small `SearchProvider` interface with two implementations:

- `RawSearchProvider`, backed by the sandbox's local structured ripgrep result;
- `WarpGrepProvider`, backed by the existing Morph provider boundary.

The `search-study` CLI runs the same versioned fixture task, deterministic editing plan,
sandbox policy, setup command, evaluator, and resource limits once per strategy. Only the
search provider varies. Each arm gets its own detached workspace and trace directory.

The study persists search count, latency, returned context bytes, a reference-file recall
proxy, time to the first reference-relevant file, unique files, and downstream task
success. The recall proxy uses file paths named by the task's read/edit plan; it is not a
claim of semantic recall. Because each provider returns its first result as one bounded
operation in this checkpoint, time to first reference-relevant file is currently the
provider operation latency when a relevant file is returned, otherwise `null`.

This checkpoint deliberately uses a deterministic fixture plan rather than pretending
that the plan is a reasoning-model response. The run manifest records that fact. Future
agent-backed studies must hold `provider=groq` and
`model=openai/gpt-oss-120b` constant across the matrix unless model choice is the subject
of the experiment.

## Consequences

The study produces attributable measurements and replayable traces without coupling the
search comparison to an unvalidated model loop. A real WarpGrep arm requires
`MORPH_API_KEY`; missing credentials are persisted as a provider error and do not get
silently replaced by raw search. Provider response text is not persisted as a raw API
payload; the adapter emits bounded search contexts and metadata only.
