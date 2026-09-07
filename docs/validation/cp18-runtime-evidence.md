# CP18 runtime evidence

Date: 2026-09-07

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
- Retry policy: no retry after the final provider failure. Provider error details are reduced to
  a code/message classification and redacted before persistence.

## Morph

- Existing spike command, using the supplied temporary Morph credential, ran one `compact`
  request: run `cd85bcc2-e253-49e9-980f-bba83d7aa8a7`, trace
  `ca2078cc-d56e-47ad-a2e5-814bc400b4e8`.
- Result: HTTP `401`, classified as a provider authentication failure. No raw response or
  credential was persisted. Existing CP4 evidence remains the source for prior WarpGrep and
  Fast Apply acceptance; this session does not claim fresh success for those components.

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
