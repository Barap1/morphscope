# CP18 runtime evidence

Date: 2026-09-07

This file records the live checks that were attempted during CP18. It contains no provider
credential or raw provider response.

## Groq

- Model: `openai/gpt-oss-120b`
- Endpoint operation: Groq chat completion through the MorphScope provider adapter
- Run: `be7d0ddf-9a35-4ed2-a8e0-13ce28de84c0`
- Result: HTTP `401`, classified as `provider_error` / `provider_failure`
- Observed latency: approximately `214 ms`
- Usage: not supplied
- Retry policy: no retry after authentication failure

The supplied temporary credential was rejected by Groq. A successful live Groq agent run is
therefore an external acceptance item pending a valid rotated credential; the deterministic
provider mock and missing-credential path remain covered by local tests.

## Real-repository and Docker boundary

- Pinned task: `morphscope-docs-search` at commit `0b33176`
- Local override run: `7d92e104-d765-4d17-8a77-d7e5584d8dfd`, resolved, score `1`, changed file `README.md`, repository validation passed
- Default Docker-mode probe: failed safely because `morphscope/sandbox:node24` was unavailable on this machine
- Docker daemon execution: not available; no Docker-backed run is represented as successful evidence
- Deterministic Docker contract tests cover network isolation, read-only image filesystem, dropped capabilities, no-new-privileges, resource ceilings, workspace bind mount, and named-container cleanup on timeout
