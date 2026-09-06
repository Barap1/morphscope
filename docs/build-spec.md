# MorphScope
## Codex Production Build & Execution Specification

**Status:** Implementation specification  
**Source of truth:** Original MorphScope PRD + this execution specification  
**Build orchestrator:** GPT-5.6 Sol / High using Sol Advisor  
**Repository visibility during development:** Private  
**Product standard:** Usable developer product, not a scripted demo

---

# 1. Mission

Build MorphScope into a production-quality open-source coding-agent evaluation, profiling, trace-replay, and adaptive-routing platform.

The system must let a developer:

1. Define a coding task against an immutable Git repository commit.
2. Run a coding-agent configuration against that task.
3. Execute the work inside an isolated environment.
4. Capture structured traces for searches, reads, model calls, edits, commands, tests, routing decisions, token consumption, latency, and cost.
5. Evaluate the resulting repository using real tests.
6. Store the trace and artifacts.
7. Replay the run through a polished web UI.
8. Compare two agent configurations side by side.
9. Run controlled experiments involving normal repository tools and Morph WarpGrep, Fast Apply, and Compact.
10. Eventually allow an adaptive policy to choose tools dynamically.

The finished application must feel like a serious AI-infrastructure developer tool rather than a portfolio mockup.

No fake metrics, fake traces, canned terminal sessions, hard-coded wins, or predetermined benchmark conclusions are permitted.

---

# 2. Non-negotiable engineering principles

## Real functionality

Every displayed run must originate from an actual stored trace.

Every displayed test result must originate from actual command execution.

Every displayed diff must originate from the sandboxed repository.

Every cost/token value must either originate from provider metadata or be explicitly identified as unavailable/estimated.

## Reproducibility

Every run records:

- task version
- repository URL
- immutable repository commit
- MorphScope git commit
- model/provider
- configuration
- environment
- tool versions
- timeout/budget values
- timestamps
- resulting patch
- evaluation result

## Security

Treat repositories, issue descriptions, files, and model output as untrusted.

Secrets must never enter benchmark containers or persisted traces unless explicitly required and safely redacted.

## Experimental integrity

Morph configurations must receive a fair baseline.

Do not tune benchmark tasks specifically to make Morph succeed.

Preserve failed runs.

## Architecture discipline

Prefer stable interfaces and small modules over speculative abstraction.

No microservices for the MVP.

No Kubernetes.

No unnecessary message queues.

No distributed infrastructure.

---

# 3. Initial technology stack

Use a pnpm TypeScript monorepo.

Recommended structure:

```text
morphscope/
├── apps/
│   ├── web/
│   └── cli/
├── packages/
│   ├── agent-core/
│   ├── controller/
│   ├── evaluator/
│   ├── providers/
│   ├── sandbox/
│   ├── schemas/
│   ├── storage/
│   ├── tracing/
│   └── ui/
├── benchmarks/
│   ├── fixtures/
│   ├── tasks/
│   └── images/
├── analysis/
│   ├── notebooks/
│   ├── reports/
│   └── training/
├── docs/
├── scripts/
├── .github/
│   └── workflows/
├── AGENTS.md
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Core technology:

- TypeScript
- Node.js current supported LTS
- pnpm
- Next.js
- React
- Tailwind CSS
- shadcn/ui / Radix primitives where useful
- Framer Motion or equivalent for intentional animation
- Zod
- SQLite for operational metadata
- filesystem content-addressed artifact storage
- DuckDB/Python for later experiment analysis
- OpenTelemetry-compatible internal tracing schema
- Docker
- Git worktrees where useful
- Vitest
- Playwright for a very small browser smoke suite
- Python + uv for statistical analysis
- GitHub Actions
- Morph official Node SDK
- ripgrep

Avoid pinning versions from memory. Resolve current mutually compatible stable versions during bootstrap and commit the lockfile.

---

# 4. UI product direction

The interface is a first-class product requirement.

MorphScope should visually communicate:

**high-performance AI infrastructure + observability + experimentation**

It should not look like:

- default shadcn demo
- generic SaaS dashboard
- admin template
- copied Linear clone
- neon cyberpunk cliché
- student-project Bootstrap UI

## Visual identity

Create a custom MorphScope visual system.

Desired qualities:

- dark-first
- sophisticated
- technical
- high information density without clutter
- excellent typography
- restrained gradients
- precise spacing
- subtle depth
- excellent motion
- clear status semantics
- striking visual hierarchy

Use strong typography and custom data visualization.

The product should remain usable in light mode if practical, but dark mode receives primary design attention.

## Motion

Animation must communicate state or causality.

Appropriate examples:

- trace timeline advancing
- expanding span trees
- synchronized comparison scrolling
- animated context-growth graph
- metric number transitions
- configuration transitions
- command execution state
- active tool-routing indicators
- diff transitions
- subtle page entrance transitions

Avoid decorative motion that interferes with reading logs, code, diffs, or measurements.

Respect `prefers-reduced-motion`.

## Generated imagery

Before final UI polish, discover all installed Codex image/design/UI skills or plugins.

Use relevant image-generation capability, including Imagen if installed and supported, to create an original MorphScope visual identity where useful.

Suitable generated assets include:

- abstract hero illustration
- trace/network motif
- branded social preview
- documentation/banner art

Do not use generated imagery to replace functional data visualizations.

Generated assets must be stored locally in the repository and optimized.

## Accessibility

Target WCAG AA fundamentals.

Keyboard navigation must work for primary interactions.

Code, traces, tables, metrics, and status states cannot depend on color alone.

---

# 5. Data model

Implement explicit schemas for:

## Experiment

- id
- name
- description
- taskSetVersion
- sourceCommit
- configurationMatrix
- createdAt
- status

## Task

- id
- repository
- commit
- issue
- setup
- evaluation
- resourceLimits
- tags
- metadata

## Run

- id
- experimentId
- taskId
- configurationId
- traceId
- repositoryCommit
- MorphScopeCommit
- provider
- model
- startedAt
- completedAt
- terminalState
- totalLatency
- totalInputTokens
- totalOutputTokens
- totalCost
- score
- failureCategory

## Span

- spanId
- traceId
- parentSpanId
- type
- start
- end
- status
- inputArtifactIds
- outputArtifactIds
- tokenUsage
- cost
- attributes
- error

## RoutingDecision

- provider category
- candidate actions
- selected action
- feature vector
- human-readable reason
- machine-readable reason
- policy version
- remaining budgets

## Artifact

- sha256
- mimeType
- size
- storagePath
- redactionStatus
- producerSpanId

Use content-addressed storage for large payloads.

---

# 6. Terminal states

A run must terminate as exactly one of:

- `resolved`
- `task_failed`
- `provider_error`
- `environment_error`
- `timeout`
- `budget_exhausted`
- `cancelled`

Partial traces must survive crashes and timeouts.

---

# 7. Sol Advisor operating policy

Sol / High is the project architect and acceptance owner.

It owns:

- interpreting requirements
- architecture
- checkpoint decomposition
- risk assessment
- integration
- debugging high-uncertainty problems
- verification strategy
- commit acceptance
- final product acceptance

## Luna requirement

Luna must actually be used.

For every checkpoint containing suitable bounded work, Sol should delegate at least one meaningful bounded task to a Luna implementation/research worker.

Good Luna assignments:

- repository reconnaissance
- repetitive schema implementation
- fixture construction
- straightforward React components
- straightforward utility implementation
- documentation
- configuration
- test scaffolding
- log/result inspection
- CSS implementation after design specification exists
- repetitive adapters

Do not delegate high-impact architecture decisions to Luna.

Do not generate artificial tasks merely to satisfy the Luna requirement.

If no checkpoint work is suitable for Luna, Sol must record why.

## Terra

Use Terra for moderately difficult implementation when delegating it saves Sol work and the task exceeds a reasonable Luna lane.

## Verification

A worker never self-certifies a checkpoint.

Sol must inspect the integrated diff and run the checkpoint verification.

For consequential checkpoints, invoke the Sol Advisor fresh-context Sol reviewer.

If the reviewer returns `fix-first`, fix the defects and obtain another fresh review.

---

# 8. Verification philosophy

Verification must be proportional.

Do not exhaust usage repeatedly proving obvious things.

Each checkpoint should normally include:

1. typecheck
2. relevant unit tests
3. lint/static checks when useful
4. one targeted integration/smoke path where the checkpoint changes integration behavior
5. diff inspection

Do not run the entire benchmark suite after a cosmetic component change.

Do not create hundreds of superficial tests.

Prefer a few high-value behavioral tests.

Full verification occurs at major integration checkpoints and final acceptance.

---

# 9. Stop conditions

Continue autonomously between checkpoints.

Do not stop merely because:

- a test initially fails
- dependency installation produces warnings
- an implementation needs revision
- a worker produces a weak solution
- minor requirements are ambiguous
- visual polishing requires iteration

Stop and ask the user only when blocked by:

- missing authentication
- missing required API credentials
- account/payment authorization
- a destructive external action
- unavailable required external service
- security-sensitive decision requiring explicit permission
- fundamental contradiction in product requirements
- unavoidable architecture choice with major irreversible consequences

Otherwise make a reasonable engineering choice, record it, and continue.

---

# 10. Git discipline

Development begins in a PRIVATE GitHub repository.

Repository name:

`morphscope`

Default branch:

`main`

Never commit directly to an unrelated repository.

Each checkpoint gets a meaningful commit only after its quality gate passes.

Use conventional commit-style messages where practical.

Do not make meaningless checkpoint commits simply because a file changed.

Never commit:

- `.env`
- tokens
- credentials
- raw secrets
- benchmark private keys
- temporary API outputs containing secrets

---

# 11. CHECKPOINT 0 — Machine, Git, and repository bootstrap

## Objective

Establish a clean, reproducible development environment and private remote repository.

## Actions

Inspect:

```bash
git --version
gh --version
gh auth status
node --version
pnpm --version
docker --version
docker info
rg --version
jq --version
python3 --version
uv --version
codex --version
```

Install only missing prerequisites.

On macOS, prefer Homebrew for appropriate local dependencies if already available.

Verify Sol Advisor installation and companion agents.

Create project directory.

Initialize git.

Create the initial monorepo metadata.

Create `.gitignore`.

Create `.env.example`.

Copy the authoritative PRD into:

```text
docs/product-prd.md
```

Create:

```text
docs/build-spec.md
```

from this specification.

Create private GitHub repository:

```bash
gh repo create morphscope \
  --private \
  --source=. \
  --remote=origin
```

Do not make it public during implementation.

## Quality gate

Confirm:

- repo exists
- remote points to intended private repository
- no secrets are staged
- workspace installs successfully
- typecheck command can execute
- basic README documents bootstrap

## Commit

```text
chore: bootstrap MorphScope workspace
```

Push.

---

# 12. CHECKPOINT 1 — Product shell and visual design system

## Objective

Create the real application shell and original visual language before the dashboard becomes fragmented.

Do not create fake product results.

Use explicit fixture/example states labelled as development fixtures where necessary.

## Build

Create:

- application navigation
- global layout
- responsive shell
- command/search affordance
- typography system
- spacing system
- semantic status tokens
- card/table primitives
- metric primitives
- code/log containers
- empty states
- loading/skeleton states
- error states
- motion tokens
- theme support
- reduced-motion handling

Initial routes:

```text
/
 /experiments
 /experiments/[id]
 /tasks/[id]
 /runs/[id]
 /compare
 /failures
 /settings
```

Create a custom MorphScope logo/wordmark treatment.

Use all relevant installed UI/design/frontend/animation/image skills.

## Quality gate

- responsive at laptop and large desktop sizes
- no obvious stock-template appearance
- keyboard navigation works for global navigation
- reduced motion works
- visual hierarchy is coherent
- no fabricated production claims appear

Run focused browser smoke test.

## Commit

```text
feat(ui): establish MorphScope product shell and design system
```

---

# 13. CHECKPOINT 2 — Schemas, tracing, artifact storage, persistence

## Objective

Implement the data foundation before the agent runtime.

Build packages:

```text
schemas
tracing
storage
```

Implement:

- Zod task schema
- experiment schema
- run schema
- span schema
- routing decision schema
- terminal states
- artifact manifest
- content-addressed artifact store
- SQLite persistence
- migrations
- redaction utility
- trace writer
- trace reader

Trace writes should be incremental so crashes preserve partial history.

## Quality gate

Test:

- schema rejection
- span nesting
- incremental persistence
- artifact deduplication
- secret redaction
- crash/partial-trace persistence

Do not exhaustively test trivial accessors.

## Commit

```text
feat(core): add trace schemas and durable artifact storage
```

---

# 14. CHECKPOINT 3 — Sandbox and baseline runner

## Objective

Make one task run end-to-end without Morph.

Build:

```text
sandbox
agent-core
evaluator
cli
```

Implement task workspace lifecycle:

1. acquire repository
2. checkout exact commit
3. create isolated working state
4. run setup
5. begin trace
6. execute baseline agent loop
7. expose safe file/search/edit/command tools
8. run evaluation
9. collect Git diff
10. persist result
11. dispose environment

Baseline tools:

- list files
- ripgrep
- read file
- deterministic replacement
- unified diff
- command execution
- tests

Implement budgets:

- wall clock
- turns
- model tokens
- approximate/provider cost
- command timeout
- retries

## Fixture repository

Create a small TypeScript fixture with several genuine bugs/tasks.

Do not hardcode agent answers into fixture evaluation logic.

## CLI target

A developer should be able to execute something conceptually similar to:

```bash
pnpm morphscope run benchmarks/tasks/example.yaml \
  --config baseline
```

## Quality gate

One command must:

- start from immutable clean state
- execute one real task
- modify repository
- execute tests
- calculate final state
- persist structured trace
- persist diff
- leave original source untouched

## Commit

```text
feat(runner): execute baseline tasks in isolated workspaces
```

This is the first major vertical slice.

---

# 15. CHECKPOINT 4 — Morph technical spike

## Objective

Validate all external Morph components independently before embedding assumptions throughout the architecture.

Require `MORPH_API_KEY`.

Do not print it.

Validate:

### WarpGrep

Run one local repository search.

Record:

- request
- returned context
- latency
- status
- available usage metadata

### Fast Apply

Perform one controlled edit.

Store:

- original hash
- edit instruction
- edit snippet
- final hash
- diff
- latency
- available usage metadata

### Compact

Perform one isolated compaction call against realistic agent context.

Store:

- before size
- after size
- retained content
- latency
- available usage metadata

Document API behavior that differs from the PRD.

## Quality gate

Each integration gets:

- actual successful API request
- timeout handling
- malformed response handling
- missing credential handling
- trace instrumentation

If Compact is unavailable or materially different, document it and continue without allowing it to block search/edit MVP functionality.

## Commit

```text
feat(morph): validate and instrument Morph provider integrations
```

---

# 16. CHECKPOINT 5 — Pluggable search experiment

## Objective

Produce the project's first scientifically meaningful comparison.

Implement `SearchProvider`.

Providers:

- `RawSearchProvider`
- `WarpGrepProvider`

Keep the reasoning model, editing strategy, task, sandbox and budgets fixed.

Implement search measurements:

- number of searches
- total search latency
- bytes/context returned
- file recall proxy
- time to first reference-relevant file
- unique files found
- downstream success

Implement:

```bash
pnpm morphscope experiment run search-study
```

Start with controlled fixtures.

Then add carefully selected real repository tasks.

## Quality gate

The same task executes under both search strategies.

Differences are persisted and attributable to configuration.

No conclusion is embedded into the code.

## Commit

```text
feat(experiments): add baseline versus WarpGrep search study
```

---

# 17. CHECKPOINT 6 — Evaluator, metrics and failure taxonomy

Implement:

- patch statistics
- syntax/build validation
- task-specific tests
- repository-native tests
- out-of-scope file detection
- failure taxonomy
- environment/provider separation
- result aggregation

Failure categories:

- environment
- provider
- retrieval
- interpretation
- planning
- generation
- application
- verification
- regression
- context loss
- stagnation
- budget exhaustion

Automatic classification should be conservative.

Expose manual correction in stored analysis metadata.

## Quality gate

Known intentionally failing fixtures must land in expected broad categories.

A failed environment must never lower agent correctness metrics as if the model solved the task incorrectly.

## Commit

```text
feat(evaluation): add scoring metrics and failure classification
```

---

# 18. CHECKPOINT 7 — Real dashboard integration

## Objective

Replace development fixture data with actual persisted run data.

### Overview

Show:

- experiment selection
- resolved rate
- median runtime
- total/median cost
- token usage
- task counts
- configuration comparison
- Pareto visualization
- task-tag breakdown

### Experiment page

Show actual experiment matrix and runs.

### Task page

Show:

- issue
- repository
- commit
- configurations
- outcomes
- run links
- patch summaries

### Run page

Create the signature MorphScope trace-replay interface.

Sections:

- run header
- terminal state
- timeline
- token/context growth chart
- search actions
- files inspected
- controller decisions
- edits
- diffs
- commands
- test results
- cost
- latency
- artifacts

Timeline and data visualizations should feel distinctive.

## Quality gate

A newly completed CLI run appears correctly in the UI without hand-written fixtures or manual data editing.

## Commit

```text
feat(web): connect polished dashboard to real experiment traces
```

---

# 19. CHECKPOINT 8 — Side-by-side trace comparison

This is a flagship feature.

Implement `/compare`.

Two runs must be constrained to the same task unless explicitly overridden.

Synchronize meaningful events where possible.

Highlight divergence:

- search selection
- search results
- files read
- edit strategy
- context size
- latency
- token count
- cost
- tests
- final patch
- terminal outcome

Provide:

- synchronized timelines
- side-by-side diffs
- metric delta bar
- event divergence markers
- expandable technical detail

Avoid animation that impairs comparison.

## Quality gate

Select baseline and WarpGrep runs for one real task and identify the first meaningful divergence in the UI.

## Commit

```text
feat(compare): add synchronized run and trace comparison
```

---

# 20. CHECKPOINT 9 — Fast Apply experiment

Implement `EditProvider`.

Providers:

- deterministic edit
- unified-diff application
- appropriate full-file generation
- Morph Fast Apply

Validate edits immediately enough to catch corruption cheaply.

Preserve:

- original file hash
- requested edit
- resulting hash
- unified diff
- syntax status
- retry count
- apply latency
- cost metadata

Do not blindly assume Fast Apply should be used for every edit.

## Quality gate

Controlled experiment holds retrieval/context constant and varies only editing strategy where possible.

## Commit

```text
feat(experiments): add Fast Apply editing study
```

---

# 21. CHECKPOINT 10 — Context measurement and Compact

Implement detailed context accounting before attempting adaptive compaction.

Compare:

- no compaction
- simple threshold truncation
- Morph Compact
- later adaptive trigger

Measure:

- context size over time
- tool-output share
- retained ratio
- future model-call savings
- task success
- information loss
- compaction latency
- compaction cost

Use tasks long enough to make the comparison meaningful.

## Quality gate

A Compact run can be replayed showing the actual before/after context event and downstream outcome.

## Commit

```text
feat(context): add context profiling and Compact evaluation
```

---

# 22. CHECKPOINT 11 — Adaptive rule-based controller

Do not begin with machine learning.

Implement transparent rules.

Potential search inputs:

- exact identifier existence
- repository size
- number of cheap grep matches
- query semantics
- cross-file estimate
- previous search failure
- remaining budget

Potential edit inputs:

- file size
- changed-line estimate
- non-contiguous regions
- exact old string availability
- prior apply failure
- remaining budget

Potential compaction inputs:

- context tokens
- growth rate
- tool-output share
- duplication
- relevance
- remaining complexity

Every route must persist:

- features
- decision
- policy version
- reason

The UI must visually expose these decisions.

## Quality gate

Adaptive mode successfully runs through the same experiment framework.

A viewer can understand why each specialized tool was or was not selected.

## Commit

```text
feat(controller): add auditable adaptive routing policy
```

---

# 23. CHECKPOINT 12 — Expanded benchmark set and analysis

Expand carefully.

Target useful initial publication set:

- TypeScript
- Python
- controlled fixtures
- real repositories
- exact lookup tasks
- exploratory tasks
- cross-file tasks
- sparse edits
- bug fixes
- feature changes

Start with low repetitions during development.

Only increase repeated nondeterministic trials for final reported results.

Analysis should calculate:

- raw counts
- medians
- percentile ranges
- paired comparisons
- bootstrap confidence intervals where sample size supports them

Never imply significance unsupported by the dataset.

## Commit

```text
feat(analysis): add reproducible benchmark analysis pipeline
```

---

# 24. CHECKPOINT 13 — Product-quality workflow

Make MorphScope comfortable to actually use.

Add:

- task validation command
- experiment resume
- duplicate-run protection
- configuration validation
- helpful CLI errors
- progress output
- cancellation handling
- trace export
- CSV/JSON result export
- artifact browsing
- filtering
- search
- shareable read-only run routes
- strong empty states
- copyable IDs/commands
- documentation for adding tasks/providers

Potential commands:

```bash
morphscope task validate
morphscope task list
morphscope run
morphscope experiment run
morphscope experiment resume
morphscope experiment list
morphscope trace export
morphscope results export
morphscope web
```

The CLI should behave like a developer tool, not an internal script collection.

## Commit

```text
feat(product): harden MorphScope developer workflows
```

---

# 25. CHECKPOINT 14 — Security and reliability hardening

Audit:

- Docker isolation
- network policy
- process limits
- memory limits
- disk limits
- timeouts
- command boundaries
- path traversal
- malicious filenames
- terminal escaping
- diff escaping
- raw HTML
- secret leakage
- artifact access
- provider errors
- interrupted runs

Do not mount the host Docker socket into benchmark containers.

Do not expose orchestration credentials to task repositories.

## Quality gate

Run a small adversarial fixture intended to:

- inspect environment variables
- escape workspace paths
- emit hostile HTML
- spam output
- hang indefinitely

Verify containment.

## Commit

```text
security: harden sandbox execution and trace rendering
```

---

# 26. CHECKPOINT 15 — CI and reproducibility

GitHub Actions should run proportional checks:

On pull request:

- install
- typecheck
- lint
- unit tests
- selected integration tests
- web build

Do not run expensive paid Morph/OpenAI benchmarks on every PR.

External-provider integration tests should be opt-in/manual or protected appropriately.

Add deterministic mock-provider tests for CI.

Generate published tables/charts through scripts rather than manual spreadsheet editing.

## Commit

```text
ci: add reproducible validation and build workflows
```

---

# 27. CHECKPOINT 16 — Deployment

Public-facing deployment is primarily read-only.

Do not expose arbitrary remote code execution through a public unauthenticated endpoint.

Recommended architecture:

### Local developer mode

Full runner + dashboard.

### Hosted public mode

Read-only dashboard displaying sanitized published traces/results.

Allow safe trace import later if justified.

Deploy web frontend once real data exists.

Do not deploy an empty shell just to have a URL.

## Commit

```text
feat(deploy): add safe read-only hosted MorphScope dashboard
```

---

# 28. CHECKPOINT 17 — Final UI refinement

This receives dedicated time.

Re-run installed:

- UI
- frontend-design
- animation
- image-generation
- accessibility
- visual-review

skills/plugins wherever available.

Review every major screen.

Polish:

- spacing
- typography
- alignment
- motion
- density
- charts
- tables
- tooltips
- loading
- errors
- empty states
- hover/focus
- responsive behavior
- comparison page
- trace replay
- landing experience

Create high-quality Open Graph/social artwork.

Do not alter measured data for aesthetics.

## Quality gate

Take screenshots of all primary screens at representative viewport sizes and conduct visual review.

Test reduced motion and keyboard navigation.

## Commit

```text
feat(ui): complete MorphScope visual and interaction refinement
```

---

# 29. CHECKPOINT 18 — Final independent review

Before declaring the project complete:

1. clean working tree
2. run full appropriate local validation
3. build web application
4. run CLI smoke path
5. run one baseline fixture
6. run one Morph fixture if credentials/budget permit
7. inspect persisted traces
8. inspect generated diff
9. open dashboard
10. replay run
11. compare two runs
12. inspect export
13. inspect README from perspective of new contributor
14. conduct security sanity check

Then invoke a **fresh Sol / High reviewer** through Sol Advisor.

Reviewer should inspect:

- architecture
- complete diff/history as appropriate
- correctness
- security
- maintainability
- experimental methodology
- product usability
- visual quality
- documentation
- PRD adherence

Verdict must be one of:

- `SHIP`
- `FIX-FIRST`
- `RETHINK`

Do not report completion after `FIX-FIRST`.

Correct the issue and obtain a new review.

## Final commit

Only if needed:

```text
chore: prepare MorphScope for initial release
```

---

# 30. Definition of done

MorphScope is not complete because the website renders.

It is complete when a new developer can:

1. clone the project
2. configure credentials
3. validate a task
4. execute a real coding-agent run
5. receive a real test outcome
6. inspect the resulting patch
7. inspect the structured trace
8. compare strategies
9. reproduce the experiment
10. understand the methodology
11. inspect actual limitations

And when a technical founder can open the hosted site and quickly understand:

- what was tested
- how it was tested
- what happened
- why two runs differed
- what specialized tooling improved
- where it failed
- why the adaptive controller chose a particular tool

That is the standard for release.

---

# 31. Autonomous build rule

Once implementation begins, proceed checkpoint by checkpoint.

For each checkpoint:

```text
UNDERSTAND
→ PLAN
→ DELEGATE appropriately
→ IMPLEMENT
→ INTEGRATE
→ VERIFY
→ FRESH REVIEW where required
→ FIX if necessary
→ COMMIT
→ PUSH
→ CONTINUE
```

Never skip a failed quality gate.

Never move forward merely because code exists.

Never ask the user to manually approve normal implementation progress.

Stop only for a genuine external blocker or after the final acceptance gate passes.