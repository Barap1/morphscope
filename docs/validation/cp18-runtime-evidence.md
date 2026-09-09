# CP18 runtime evidence

Date: 2026-09-08

This file records the focused post-CP18 release-hardening checks. It contains no provider
credential or raw provider response.

## Groq

- Model: `openai/gpt-oss-120b`
- Direct authentication probe: `GET https://api.groq.com/openai/v1/models` returned HTTP
  `200`; authentication succeeded and the requested model was listed.
- MorphScope adapter smoke: run `b64a5505-bd58-4e4a-9c21-f4372d72f15c`, trace
  `3809ffec-6d22-44b0-a8b7-a53cb6578a33`, HTTP `200`, latency `364.9 ms`, usage `85` input,
  `48` output, `133` total tokens, including `46` reasoning tokens. The deliberately small
  completion reached its length limit before returning visible text; provider metadata was
  persisted without the response body or credential.
- Actual agent fixture: run `cac54712-f2c7-447d-846a-04d620885764` reached the provider and
  received one HTTP `200` completion (`520.97 ms`, `438` input, `30` output, `468` total,
  including `7` reasoning tokens), then received HTTP `400` with the safe provider detail
  `json_validate_failed`. The overall run is correctly classified as `provider_error` /
  `provider_failure`; a successful multi-turn agent fixture is not claimed.
- The persisted fixture metadata records MorphScope commit `8ed60fb5d1ed72a8ded4e5e78245fe51699718ea`;
  this run is retained as evidence that the real agent path reached Groq, not as a current-code
  end-to-end success claim. No further live calls were made after the bounded adapter smoke and
  fixture attempt.
- Retry policy: no retry after the final provider failure. Provider error details are reduced to
  a code/message classification and redacted before persistence.

### Multi-turn protocol correction

The failure was investigated against the current Groq documentation for [JSON Object
Mode](https://console.groq.com/docs/json-mode), [Structured
Outputs](https://console.groq.com/docs/structured-outputs), and [GPT-OSS
reasoning](https://console.groq.com/docs/reasoning). GPT-OSS supports strict JSON Schema output;
the earlier request used the older JSON Object Mode while carrying a custom host-controlled
operation history. MorphScope does not enable provider-native agent tools: repository operations
remain explicit host actions, and their bounded results are returned as the next user message.

The smallest correction is now in `packages/agent-core/src/index.ts`:

- every reasoning request uses one closed, strict `json_schema` named
  `morphscope_repository_operation`;
- the schema requires `action` and `args`, with operation-specific closed argument objects and
  explicit `null` values for optional arguments;
- the second request preserves the original user message, the assistant's JSON operation, and a
  redacted `<operation_result>` user message;
- `include_reasoning: false` and `reasoning_effort: low` remain explicit, while the existing output
  token budget is preserved.

Redacted structural comparison from the deterministic protocol tests:

```text
request 1
  messages: [user(task + protocol instructions)]
  response_format: { type: json_schema, json_schema: { name: morphscope_repository_operation,
                   strict: true, schema: [closed action/args union] } }
  include_reasoning: false
  reasoning_effort: low
  max_completion_tokens: computed from remaining budget

request 2
  messages: [user(task + protocol instructions),
             assistant(redacted JSON operation),
             user(<operation_result action="search">[redacted bounded result]</operation_result>)]
  response_format: same strict schema
  include_reasoning: false
  reasoning_effort: low
  max_completion_tokens: computed from remaining budget
```

The regression coverage is deterministic and provider-free: `CI=true pnpm vitest run
packages/agent-core packages/providers` passed `35` tests, including agent assertions for the
strict schema and preserved operation-result history and provider assertions for exact two-turn
request forwarding. No post-correction live Groq acceptance is claimed in this checkout because
the current environment has no `GROQ_API_KEY`; the prior `json_validate_failed` run remains the
only live multi-turn result.

## Morph

- Existing spike command, using the supplied temporary Morph credential, ran one `compact`
  request: run `cd85bcc2-e253-49e9-980f-bba83d7aa8a7`, trace
  `ca2078cc-d56e-47ad-a2e5-814bc400b4e8`.
- Result: HTTP `401`, recorded by the adapter as a `http_error` provider failure. This is
  consistent with an authentication rejection at the HTTP boundary, but the adapter does not
  claim a narrower machine-level authentication category. No raw response or credential was
  persisted. Existing CP4 evidence remains the source for prior WarpGrep and Fast Apply
  acceptance; this session does not claim fresh success for those components.

## Real-repository and Docker boundary

- Runtime: Docker Desktop `29.6.2`, context `desktop-linux`, daemon available.
- Image: built from the repository `Dockerfile.sandbox` with the canonical command
  `docker build -f Dockerfile.sandbox -t morphscope/sandbox:node24 .`.
- Default Docker-mode fixture: run `a97d1a5f-370b-460c-866f-c54e4311e5b9`, trace
  `ded69a22-c3fc-4768-8f25-d5634d4a8ec5`, task commit `0b33176`, terminal state `resolved`,
  score `1`. The run checked out the pinned repository, executed the task and repository
  validation, collected the README patch, persisted the trace, and removed its command
  container. Patch artifact SHA-256:
  `412dd8bfa6cc894fdb5b5aa2d61694a95dda7b3ddcc6872325ceb6a684a1d9a8`.
- Docker runtime configuration was inspected on a disposable container using the same sandbox
  settings: network mode `none`, read-only root filesystem, `cap-drop=ALL`,
  `no-new-privileges`, `512 MiB` memory, `1` CPU, `128` PIDs, and only the task workspace
  bind-mounted writable. The inspection container was removed; no benchmark data depended on it.
- Verified by the real daemon: image build, container launch, workspace/task/evaluation flow,
  patch and trace persistence, cleanup, and the listed runtime isolation settings.
- Covered only by contract tests: broader adversarial behavior and host-kernel isolation beyond
  the configured Docker boundary. The earlier invalid bind-mount option was corrected before
  the successful default-mode run.

## Hosted dashboard and read-only boundary

- The sanitized snapshot was regenerated after commit `dc971fd8dd155a62802b8e54688cac1fbfb5d400`.
  It contains `32` allowlisted runs, `12` experiments, and self-contained contracts for the
  five task definitions used by the dashboard, including all four task IDs with published
  runs. Hosted task pages therefore do not depend on benchmark files being present in the
  Vercel deployment.
- The final Vercel deployment is `dpl_Eodd7aAbnv61AfXhuvgRqWKTTgpP`, status `READY`, in project
  `barap1s-projects/morphscope`, with production alias `https://morphscope.vercel.app`. It was
  deployed from release-candidate commit `74f88dc6936b877bec6492a3537a6fe40fab3b35`. The hosted
  data path is read-only and uses the committed sanitized snapshot; no provider credentials are
  required by the web runtime.
- Final browser route smoke checks covered the homepage, experiments, one experiment detail, one
  task, one run detail, comparison, failure explorer, settings, and the shareable run route. All
  9 routes rendered without a not-found heading; the shareable route resolved to the canonical run
  surface. Representative routes emitted no console errors or warnings.
- The final responsive pass checked all 9 routes at `1440x900`, `1280x800`, `1024x768`, `768x1024`,
  and `390x844`: 45 route/viewport combinations, all with bounded document/body width and a
  rendered heading. The experiment-detail overflow found at `1024x768` was fixed by allowing
  long task-contract values to wrap and was rechecked cleanly.
- Production safety checks found no provider environment variables in the Vercel production
  environment, no public `/api/run`, `/api/execute`, or `/api/provider` route, and no absolute
  private filesystem paths, bearer tokens, or provider credentials in representative responses.
- The existing CLI trace export was run once against the Docker fixture and wrote a non-empty
  `7,448`-byte JSON export to a temporary path, which was removed immediately afterward.
- Browser review on the final deployment used temporary Chrome through `agent-browser`: desktop
  overview, trace replay, comparison, and failure-explorer screenshots were visually inspected;
  a `390x844` mobile screenshot was inspected; and the `dark` plus `reduced-motion` media settings
  were exercised. A bounded tab traversal reached the skip link, mobile navigation, command menu,
  theme control, primary links, latest-trace link, and the focusable evidence block. Final
  interactions verified mobile navigation open/close (`aria-expanded` true then false), failure
  filtering, run-ID clipboard copy, and share-route resolution.
- The existing Axe `4.12.1` baseline reported zero violations on the immediately preceding
  comparison page (`46` passes, `0` incomplete) and homepage (`38` passes, `1` incomplete). The
  homepage incomplete item is the contrast rule’s inability to determine the background behind text
  over the hero image; it is not reported as a violation. A new Axe runner is not wired into this
  repository, so this pass performed a browser structural accessibility recheck instead: all final
  key pages had named buttons, a skip link, a coherent heading sequence, and no missing image alt
  text other than the intentional decorative hero asset. Focus-visible and reduced-motion rules
  remain present in the CSS.
