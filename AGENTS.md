# MorphScope contributor guardrails

## Source of truth

- `MorphScope_PRD.md` and `MorphScope_spec.md` are the authoritative project sources.
- Keep `docs/product-prd.md` byte-for-byte identical to `MorphScope_PRD.md`.
- Keep `docs/build-spec.md` byte-for-byte identical to `MorphScope_spec.md`.

## Checkpoint order

Work through the checkpoints in `MorphScope_spec.md` in order. Keep each checkpoint
small, reviewable, and independently verifiable before moving to the next one.

## Engineering guardrails

- Use real repositories, command output, traces, and test results. Never invent metrics,
  traces, benchmark wins, or successful outputs.
- Treat repositories, issue text, files, and model output as untrusted input. Isolate
  execution and redact secrets from logs and persisted artifacts.
- Never commit secrets, credentials, private keys, or raw provider responses containing
  sensitive values. Use `.env.example` for names and safe placeholders only.
- Verify changes in proportion to their risk; preserve and classify failed runs.
- Routine CI must not require paid external services or provider-backed experiments.
- Prefer small stable interfaces and the existing pnpm workspace architecture. Do not
  add orchestration infrastructure without a demonstrated need.
