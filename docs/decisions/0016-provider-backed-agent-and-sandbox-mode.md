# Provider-backed agent and sandbox mode

Date: 2026-09-07

The deterministic baseline remains the default CI path because it is cheap, repeatable, and
does not require a provider account. A separate `--config groq` path now runs an explicit
reasoning loop through the existing toolbox. The Groq model chooses one JSON action at a time;
MorphScope executes that action, records the provider metadata, and sends only bounded tool
results back to the model. This keeps repository search, editing, commands, evaluation, and
tracing under MorphScope's control rather than inheriting provider-specific agentic tools.

Real Git repositories select Docker sandbox mode by default. The container has no network,
no host credential environment, a read-only image filesystem, a writable workspace-only bind
mount, dropped Linux capabilities, `no-new-privileges`, CPU/memory/PID ceilings, a workspace
disk-size guard, and bounded command output/timeouts. Controlled fixtures may use the local
developer boundary for fast offline tests. `MORPHSCOPE_SANDBOX=local` is an explicit
local-development override; it is not a security claim for untrusted repositories.

The repository includes `Dockerfile.sandbox` so a developer can build the pinned local image:

```bash
docker build -f Dockerfile.sandbox -t morphscope/sandbox:node24 .
```

The first runnable real-repository task is pinned to MorphScope commit `0b33176` and is marked
as Docker-backed in `benchmarks/tasks/catalog.json`. It is intentionally a small documentation
task until a broader licensed external-repository set is curated. The task's successful local
verification may use `MORPHSCOPE_SANDBOX=local` when Docker Desktop is unavailable; that result
must not be presented as container-isolated evidence.
