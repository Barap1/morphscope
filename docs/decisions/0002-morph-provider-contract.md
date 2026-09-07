# Morph provider contract

Date: 2026-09-07

The CP4 provider boundary uses Morph's OpenAI-compatible HTTP API directly rather than
coupling the runner to an SDK package before the first live spike. The adapter keeps the
provider payload and response parsing in `@morphscope/providers`, with no API key in logs,
traces, or persisted artifacts.

The current documented contracts are:

- WarpGrep uses `POST /v1/chat/completions`, model `morph-warp-grep-v2.1`, a repository
  structure plus natural-language search message, and tool-call turns that the client
  executes locally.
- Fast Apply uses `POST /v1/chat/completions`, model `morph-v3-fast`, and the structured
  `<instruction>`, `<code>`, and `<update>` message format. The raw response contains the
  merged file in `choices[0].message.content`.
- Compact uses `POST /v1/compact` with `input`, optional `query`,
  `compression_ratio`, and `preserve_recent`; the result is read from `output` or
  structured messages.

The implementation records status, latency, model, response ID, and provider-reported
usage when present. It treats missing credentials, timeouts, non-2xx responses, and
malformed payloads as explicit provider errors. A live successful request is intentionally
not claimed until MORPH_API_KEY is supplied. The live CP4 WarpGrep response used the
documented local tool-call flow but did not return a usable final context payload. The
adapter therefore preserves any actual local read output as an explicitly labeled
local_read_fallback context instead of inventing a provider result; the result metadata
keeps this deviation visible.

References:

- <https://docs.morphllm.com/api-reference/endpoint/warpgrep>
- <https://docs.morphllm.com/api-reference/endpoint/apply>
- <https://docs.morphllm.com/sdk/components/compact>
