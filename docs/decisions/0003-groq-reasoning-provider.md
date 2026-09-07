# Groq reasoning provider

Date: 2026-09-07

MorphScope uses Groq as its initial reasoning-model provider. The default model is
openai/gpt-oss-120b, sent to Groq's OpenAI-compatible endpoint with GROQ_API_KEY.
The openai/ prefix is part of Groq's model identifier; MorphScope does not call the
OpenAI API and does not require an OPENAI_API_KEY.

The reasoning provider remains abstract and pluggable. The provider adapter records the
provider, configured/returned model, endpoint, status, latency, response ID, token usage
when supplied, and rate-limit metadata. A provider error is recorded separately from a
task or verification failure. Missing credentials fail before a request. HTTP 429 is
classified as rate limiting, preserves retry-after and available reset metadata, and
does not enter an automatic retry loop.

Groq Compound is intentionally not used for the normal MorphScope benchmark provider.
Its integrated agentic tools would add another variable to a controlled comparison of
repository search, editing, and context strategies. MorphScope instead gives the
reasoning model the same explicit tool boundary in every configuration.

Development is constrained to the providers' free allowances. The default model is
explicitly configured and recorded in each reasoning run; a different model must be an
intentional configuration change rather than a silent fallback. Nominal model pricing
and actual free-tier coverage remain separate concepts; an API response without billing
metadata is not recorded as a literal $0 cost.

The live contract checks performed for CP4 used these current official references:

- Groq API reference: https://console.groq.com/docs/api-reference
- Groq GPT-OSS 120B model page: https://console.groq.com/docs/model/openai/gpt-oss-120b
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Morph WarpGrep: https://docs.morphllm.com/api-reference/endpoint/warpgrep
- Morph Fast Apply: https://docs.morphllm.com/sdk/components/fast-apply
- Morph Compact: https://docs.morphllm.com/sdk/components/compact
