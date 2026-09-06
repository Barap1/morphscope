# MorphScope

## Product Requirements Document

**Working title:** MorphScope  
**Product type:** Open-source coding-agent evaluation, profiling, and adaptive routing platform  
**Primary objective:** Build a technically credible project closely aligned with Morph's work, then use the project and its findings to open a conversation with Morph founder Tejas Bhakta about an internship or small trial project.  
**Intended builder:** A Georgia Tech computer science student interested in AI, security, software engineering, and coding agents.  
**Document status:** Initial build specification  
**Last updated:** September 2026

---

## 1. Executive Summary

MorphScope is an open-source system for measuring and optimizing the complete workflow of an AI coding agent.

Most coding-agent projects focus on whether an agent eventually produces a correct answer. MorphScope studies *how* it gets there. It records where the agent spends time and tokens, which files it searches, how its context grows, how it edits code, why attempts fail, and whether specialized tools improve the result.

The initial system will compare several agent configurations:

1. A conventional baseline using normal repository search and full-file or patch-based editing.
2. A pipeline using Morph WarpGrep for repository search.
3. A pipeline using Morph Fast Apply for code-edit application.
4. A pipeline using Morph Compact for context management.
5. An adaptive pipeline that decides when each specialized tool is likely to help.

Every run will execute inside a reproducible sandbox and will be evaluated with repository-native tests. MorphScope will record task success, latency, cost, token usage, search quality, patch quality, regressions, context growth, and failure type. A web interface will allow users to replay runs and compare two configurations step by step.

The project's key contribution is not simply integrating Morph APIs. It is producing an honest, reproducible evaluation of where specialized coding-agent infrastructure helps, where it does not help, and how an agent can select the correct tool dynamically.

---

## 2. Why This Project Exists

### 2.1 Career objective

The project is intended to demonstrate the capabilities that a small, technically demanding AI infrastructure company values:

- Independent problem selection and execution
- Understanding of coding-agent architecture
- Careful measurement rather than anecdotal demos
- Systems thinking across latency, cost, correctness, and reliability
- Ability to work with unfamiliar repositories
- Honest analysis of successes and failures
- Production-quality engineering and documentation

The shared motel-family background may make an outreach message personally memorable to Tejas Bhakta. MorphScope must provide the technical substance that makes the conversation worth continuing.

### 2.2 Technical motivation

A coding agent repeatedly performs a loop:

1. Understand the requested change.
2. Search an unfamiliar repository.
3. Read and reason about relevant code.
4. Generate an edit.
5. Apply the edit.
6. Run tests or other verification.
7. Diagnose failures and retry.

Traditional agents may use the same large model for most stages. They may repeatedly read large files, pollute their context with search output, rewrite more code than necessary, and retain failed attempts long after those attempts stop being useful.

Morph's product thesis is that important stages of this loop benefit from specialized models and specialized inference. MorphScope will evaluate that thesis at the system level.

### 2.3 Why a benchmark alone is insufficient

A static benchmark table would be useful but incomplete. The project must also make agent behavior understandable. Therefore, MorphScope combines:

- A reproducible benchmark harness
- Fine-grained tracing and observability
- A visual trace-replay interface
- Failure classification and analysis
- An adaptive routing policy

The benchmark supplies evidence. The replay interface makes the evidence understandable. The adaptive policy turns the findings into an engineering contribution.

---

## 3. Product Vision

MorphScope should become a small but rigorous laboratory for answering questions such as:

- When is an exact search tool faster and sufficient?
- When does an LLM-based search subagent find context that normal search misses?
- Which repository or task characteristics predict the better search strategy?
- When is a semantic apply model safer or cheaper than a full-file rewrite?
- At what point does accumulated context begin to harm an agent?
- Can context be reduced without losing information needed for the next step?
- Which stages dominate end-to-end latency and cost?
- Which failures originate in retrieval, reasoning, editing, application, or verification?
- Can a lightweight controller choose tools better than an always-on policy?

The final project should allow a technically sophisticated viewer to inspect the evidence rather than trust a marketing claim.

---

## 4. Goals and Non-Goals

### 4.1 Goals

- Build a working coding-agent harness that operates on real Git repositories.
- Support interchangeable search, edit, and context-management strategies.
- Integrate WarpGrep, Fast Apply, and Compact through their documented interfaces.
- Run tasks in isolated, reproducible environments.
- Capture a structured trace for every meaningful agent action.
- Evaluate completed work with tests and additional patch-quality checks.
- Compare configurations through controlled ablation experiments.
- Build an adaptive controller that selects tools based on task and runtime features.
- Present results in a polished web dashboard.
- Publish raw data, methodology, limitations, and reproducibility instructions.
- Produce a short technical report containing findings that could interest Morph.

### 4.2 Non-goals

- Training a frontier language model from scratch.
- Reproducing Morph's proprietary models or infrastructure.
- Claiming to replace SWE-bench or another established benchmark.
- Building a full Cursor, Claude Code, or Codex competitor.
- Supporting every programming language in the first version.
- Creating a polished commercial SaaS product before the experiments work.
- Proving in advance that the Morph configuration is always superior.
- Optimizing CUDA kernels without appropriate hardware and expertise.
- Using benchmark results as marketing without disclosing experimental limitations.

---

## 5. Target Users

### 5.1 Primary user: AI infrastructure engineer

An engineer wants to understand how individual components affect coding-agent performance. The engineer needs reproducible experiments, detailed traces, and raw results.

### 5.2 Secondary user: coding-agent developer

A developer wants to compare search, editing, and context strategies before adding them to an agent framework.

### 5.3 Secondary user: technical recruiter or founder

A founder reviewing the project should be able to understand its purpose in under two minutes, inspect a live result, and then examine the implementation and methodology in greater depth.

### 5.4 Internal user: project builder

The builder needs a structured platform for learning agent architecture, TypeScript, API integrations, evaluation design, observability, sandboxing, and data analysis.

---

## 6. Core Product Concept

Each benchmark task consists of:

- A repository URL and immutable commit hash
- A natural-language issue or requested change
- Environment setup instructions
- A test command
- A time and resource budget
- A hidden or protected evaluation test when practical
- A known reference patch for analysis, not for agent input

For every task, the harness creates a clean repository worktree or container, runs one agent configuration, captures the complete trace, evaluates the resulting repository, and stores the outcome.

The same task is repeated across configurations. Results are aggregated only after the system preserves the individual traces and artifacts.

---

## 7. Agent Configurations

### 7.1 Baseline configuration

The baseline should represent a credible conventional coding agent, not an intentionally weak straw man.

Recommended baseline:

- Same reasoning model used in the Morph configurations
- Standard file-listing and `ripgrep` tools
- File reads performed by the main agent
- Unified diff, deterministic replacement, or full-file output for editing
- No Morph search, apply, or context APIs
- Same test tools, token budget, retry count, and time limit

### 7.2 WarpGrep configuration

- Replace or supplement conventional exploratory search with WarpGrep.
- Keep reasoning model, editing strategy, and task budget fixed.
- Preserve every WarpGrep query, returned context, latency, and token cost.

### 7.3 Fast Apply configuration

- Keep search behavior fixed.
- Ask the reasoning model to emit minimal edit snippets and instructions.
- Use Fast Apply to merge edits into existing files.
- Record the original file hash, edit request, merged output hash, unified diff, latency, and any apply error.

### 7.4 Compact configuration

- Keep search and editing behavior fixed.
- Trigger compaction using a documented threshold or policy.
- Store the context before and after compaction.
- Measure retained lines, removed lines, compression ratio, latency, and downstream task success.

### 7.5 Full Morph configuration

- WarpGrep for exploratory repository search
- Fast Apply for appropriate existing-file edits
- Compact for long-running context management
- Same reasoning model and overall task limits as the baseline

### 7.6 Adaptive configuration

The adaptive controller selects tools at runtime rather than enabling everything for every task.

Initial decisions:

- Raw search versus WarpGrep
- Deterministic edit versus Fast Apply versus full rewrite
- Whether and when to compact context
- Whether a failed test requires more search, a new patch, or termination

The first controller should be rule-based. A learned model can be added after enough traces exist.

---

## 8. Adaptive Controller

### 8.1 Purpose

Specialized tools have overhead. A natural-language search subagent may be valuable for behavior distributed across a repository but unnecessary for an exact symbol lookup. Likewise, semantic edit application may help with a sparse multi-location change but may be unnecessary for a simple deterministic replacement.

The controller's purpose is to find the useful break-even points.

### 8.2 Search-routing features

- Repository file count and source lines of code
- Number of programming languages
- Query length
- Exact identifiers present in the task
- Number of files returned by a cheap initial search
- Whether the task describes behavior rather than a named symbol
- Estimated cross-file scope
- Dependency-graph breadth
- Whether earlier searches failed
- Remaining latency and token budgets

### 8.3 Edit-routing features

- Target file size
- Estimated number of changed lines
- Number of non-contiguous edit regions
- Whether an exact old string is known
- Whether the change is syntactic or semantic
- Language and parser availability
- Prior apply failures
- Model confidence or format validity
- Remaining retry budget

### 8.4 Compaction features

- Current context size
- Context growth rate
- Fraction of context produced by tool output
- Age of each message or result
- Symbols and files referenced by the current hypothesis
- Relevance to the most recent test failure
- Duplicate content estimate
- Remaining task complexity
- Expected future model-call cost

### 8.5 Controller progression

**Phase 1: Fixed rules.** Implement transparent heuristics and log every decision reason.

**Phase 2: Offline oracle analysis.** For tasks executed under multiple configurations, identify which strategy would have produced the best result under different objectives.

**Phase 3: Learned policy.** Train a small interpretable classifier or gradient-boosted model to predict the best action. Avoid deep reinforcement learning unless the dataset and results justify it.

**Phase 4: Online evaluation.** Freeze the policy and evaluate it on held-out repositories. Do not train and test on tasks from the same repository family without disclosing the leakage risk.

---

## 9. Functional Requirements

### FR-1: Task registry

The system shall define tasks in version-controlled YAML or JSON files. Each definition must include repository, commit, issue text, setup command, evaluation command, resource limits, and tags.

### FR-2: Reproducible workspace

The runner shall create a clean, isolated workspace for every run. A failed or malicious task must not modify the host workspace outside its assigned directory.

### FR-3: Pluggable search providers

The agent shall support at least:

- Exact or regex search through `ripgrep`
- File and symbol inspection
- WarpGrep repository search

### FR-4: Pluggable edit providers

The agent shall support at least:

- Deterministic text replacement
- Unified diff application
- Full-file generation where appropriate
- Fast Apply for existing files

### FR-5: Context providers

The agent shall support:

- No compaction
- Threshold-based truncation as a baseline
- Morph Compact
- An adaptive compaction trigger

### FR-6: Tool execution

The agent shall execute allowlisted repository commands inside the sandbox and capture exit code, stdout, stderr, duration, and resource usage.

### FR-7: Test verification

The evaluator shall run repository-native tests and task-specific tests. A patch is not successful merely because it applies cleanly.

### FR-8: Trace capture

The system shall assign a trace ID to every run and create nested spans for model calls, searches, file reads, edits, compaction, commands, tests, and controller decisions.

### FR-9: Run comparison

The web interface shall allow two runs of the same task to be compared side by side.

### FR-10: Trace replay

The web interface shall present the chronological sequence of agent actions, context size, cost, latency, file access, patches, test results, and retries.

### FR-11: Experiment management

The command-line interface shall run a task or experiment matrix, resume interrupted experiments, and avoid silently overwriting completed results.

### FR-12: Export

Users shall be able to export summary results as CSV or JSON and individual traces as structured JSON.

### FR-13: Failure classification

The analysis pipeline shall assign a failure category automatically where possible and allow manual correction.

### FR-14: Reproducibility manifest

Every run shall store model identifier, provider, prompts, tool versions, task version, repository commit, configuration, environment image, start time, and random seed where supported.

---

## 10. Non-Functional Requirements

### 10.1 Reproducibility

Given the same task definition, repository commit, model, configuration, and seed support, another developer should be able to rerun the experiment. Model nondeterminism must be acknowledged rather than hidden.

### 10.2 Security

- Run repository code inside containers or another isolated sandbox.
- Do not expose host credentials to task containers.
- Pass only the API credentials required by the orchestration layer.
- Redact secrets from stored prompts, tool outputs, and traces.
- Enforce execution timeouts, memory limits, process limits, and disk limits.
- Disable network access during test execution unless a task explicitly requires an allowlisted endpoint.
- Treat repository content as untrusted instructions.

### 10.3 Reliability

- A single failed run must not terminate an experiment batch.
- Partial traces must be preserved after timeouts or crashes.
- Provider errors and benchmark failures must be distinguishable.
- Runs must have explicit terminal states.

### 10.4 Observability

Every external call and tool invocation must expose timing, status, and correlation identifiers. Raw sensitive reasoning should not be required; tool actions and structured decisions are sufficient.

### 10.5 Extensibility

Search, edit, model, context, sandbox, and evaluator implementations should share stable interfaces so that alternatives can be added without rewriting the runner.

### 10.6 Performance

The profiling layer should add minimal overhead. Measure its overhead with a no-op or mock-provider experiment and report it.

---

## 11. Proposed Architecture

### 11.1 Components

**CLI / Experiment Orchestrator**

- Loads tasks and experiment configurations
- Creates the run matrix
- Manages concurrency and retries
- Starts sandboxed runners
- Writes run manifests and terminal status

**Agent Runtime**

- Maintains conversation state
- Exposes search, read, edit, and command tools
- Calls the selected reasoning model
- Enforces task budgets
- Sends routing decisions to the controller

**Provider Adapters**

- Standard search adapter
- WarpGrep adapter
- Standard edit adapter
- Fast Apply adapter
- No-compaction adapter
- Compact adapter
- Model-provider adapters

**Sandbox Manager**

- Clones or mounts the repository at a fixed commit
- Creates a clean branch or worktree
- Builds and runs the task environment
- Enforces resource and network policy
- Collects filesystem changes

**Evaluator**

- Runs tests
- Calculates patch statistics
- Compares touched files with reference-patch files
- Detects out-of-scope modifications
- Produces the final score and failure category

**Trace Store**

- Stores runs, spans, events, token usage, costs, artifacts, and metrics
- Uses local DuckDB or SQLite initially
- Can migrate to PostgreSQL if concurrent hosted use becomes necessary

**Analysis Pipeline**

- Aggregates experiment results
- Calculates confidence intervals
- Produces ablation tables and Pareto frontiers
- Mines failure patterns
- Builds datasets for the adaptive controller

**Web Dashboard**

- Lists experiments and tasks
- Displays summary comparisons
- Replays a trace
- Shows file access and patch diffs
- Compares two runs
- Displays failure clusters

### 11.2 Suggested monorepo structure

```text
morphscope/
  apps/
    web/                  # Next.js dashboard
    cli/                  # Experiment CLI
  packages/
    agent-core/           # Agent loop and budgets
    controller/           # Rules and learned routing policy
    providers/            # Model and Morph adapters
    sandbox/              # Docker/worktree management
    evaluator/            # Tests and scoring
    tracing/               # Spans, events, redaction
    schemas/               # Shared TypeScript schemas
  analysis/
    notebooks/            # Exploratory analysis
    reports/              # Generated tables and plots
    training/             # Adaptive-policy training
  benchmarks/
    tasks/                 # Versioned task definitions
    images/                # Docker definitions
    fixtures/              # Small controlled repositories
  docs/
    methodology.md
    architecture.md
    security.md
    adding-a-task.md
  scripts/
  .github/workflows/
```

---

## 12. Trace and Data Model

### 12.1 Experiment

- `experiment_id`
- Name and description
- Creation timestamp
- Configuration matrix
- Task-set version
- Git commit of MorphScope
- Status

### 12.2 Run

- `run_id`
- `experiment_id`
- `task_id`
- Configuration ID
- Repository commit
- Model and provider
- Start and end timestamps
- Terminal state
- Final score
- Total tokens, cost, and latency
- Final patch artifact
- Environment manifest

### 12.3 Span

- `span_id`
- `trace_id`
- Parent span ID
- Span type
- Start and end timestamps
- Input and output references
- Token usage
- Cost
- Status and error classification

### 12.4 Event types

- Agent turn started or completed
- Controller decision
- Model request or response
- Search query or result
- File read
- Edit requested
- Edit applied or rejected
- Command executed
- Test started or completed
- Context compacted
- Budget warning
- Retry
- Terminal success, failure, error, or timeout

### 12.5 Artifact

Large content should be stored as content-addressed artifacts rather than duplicated inside every event.

- SHA-256 hash
- MIME type
- Byte size
- Redaction status
- Storage path
- Producing span

Artifacts may include prompts, responses, search output, file snapshots, diffs, logs, and test reports.

---

## 13. Benchmark Dataset

### 13.1 Stage A: Controlled fixtures

Create small repositories where expected behavior is completely understood. These validate the harness itself.

Include tasks such as:

- Exact symbol change in one file
- Behavior spread across three files
- Rename requiring call-site updates
- Error-handling addition
- Configuration-driven bug
- Test failure whose cause is outside the test file
- Large file with a sparse edit
- Multiple similar functions that can confuse edit placement

### 13.2 Stage B: Curated real repositories

Choose maintained repositories with:

- Fast setup and tests
- Permissive licenses
- Manageable resource requirements
- Clear historical issues and patches
- Language coverage matching available tooling

Start with TypeScript and Python. Add other languages only after the runner is stable.

### 13.3 Stage C: Held-out evaluation

Keep several repositories entirely outside controller development. Use these only after rules or learned policies are frozen.

### 13.4 Task tags

- Exact lookup
- Exploratory search
- Cross-file reasoning
- Single-region edit
- Multi-region edit
- Large-file sparse edit
- Bug fix
- Feature addition
- Refactor
- Test repair
- Documentation or configuration change

---

## 14. Metrics

### 14.1 Primary metrics

**Resolved rate:** Percentage of tasks that pass all required evaluation tests.

**Cost per resolved task:** Total provider and specialized-tool cost divided by successful tasks.

**Time to resolution:** Wall-clock time from task start through successful verification.

These should be evaluated together. Optimizing only one can create misleading conclusions.

### 14.2 Retrieval metrics

- File recall against files touched by the reference patch
- Time to first relevant file
- Number of search operations
- Number and bytes of files read
- Irrelevant context returned
- Search cost
- Search latency

Reference-patch file recall is an imperfect proxy: a valid alternative patch may touch different files. Flag such cases for review.

### 14.3 Editing metrics

- Apply success rate
- Correctness after tests
- Lines added, removed, and modified
- Unrelated lines changed
- Number of edit retries
- Time and cost per edit
- Syntax validity after edit
- Semantic drift indicators

### 14.4 Context metrics

- Context tokens by turn
- Tool-output share of context
- Compaction ratio
- Lines retained and removed
- Required-information retention
- Downstream success after compaction
- Cost avoided in later calls
- Compaction latency and cost

### 14.5 Agent-behavior metrics

- Total turns
- Repeated searches
- Repeated file reads
- Failed hypotheses
- Tests executed
- Loop or stagnation detection
- Recovery after first failure

### 14.6 Statistical reporting

- Report raw counts and sample sizes.
- Include medians and percentile ranges for skewed latency and cost data.
- Use bootstrap confidence intervals where appropriate.
- Pair results by task when comparing configurations.
- Separate task-level success from run-level success when multiple trials are used.
- Do not claim statistical significance from a very small pilot.

---

## 15. Failure Taxonomy

Every unsuccessful run should end in one primary category and optional contributing categories.

1. **Environment failure:** Repository could not be installed or evaluated.
2. **Provider failure:** External model or tool API failed.
3. **Retrieval failure:** Relevant implementation was never found.
4. **Interpretation failure:** Relevant code was found but misunderstood.
5. **Planning failure:** Proposed change could not satisfy the task.
6. **Generation failure:** Model emitted invalid or incomplete edit content.
7. **Application failure:** Intended edit was not merged correctly.
8. **Verification failure:** Agent misread or ignored test results.
9. **Regression:** Target issue was fixed but unrelated behavior broke.
10. **Context-loss failure:** Needed information disappeared after truncation or compaction.
11. **Loop/stagnation:** Agent repeated actions without meaningful progress.
12. **Budget exhaustion:** Agent reached time, token, cost, or turn limits.

Automatic classification may use trace rules first. A language-model classifier can propose labels, but manually verified labels should be used for important published findings.

---

## 16. Dashboard Requirements

### 16.1 Overview page

- Experiment selector
- Configuration comparison
- Resolved rate
- Median time and cost
- Token usage
- Pareto frontier of correctness versus cost or latency
- Breakdown by task tag

### 16.2 Task page

- Issue text
- Repository and commit
- Reference metadata
- Results across configurations
- Links to individual traces
- Final diffs and test outcomes

### 16.3 Trace page

- Chronological span timeline
- Cumulative tokens, cost, and context size
- Search queries and files returned
- Files opened
- Controller decisions and explanations
- Generated edits and applied diffs
- Command and test output
- Failure or success explanation

### 16.4 Comparison page

Two synchronized trace columns should show:

- Where behavior diverged
- Different search choices
- Different context growth
- Different files inspected
- Patch differences
- Timing and cost deltas
- Test-result differences

### 16.5 Failure explorer

- Failure-category distribution
- Filter by configuration, repository, language, or task type
- Similar-trace clusters
- Representative failure replay
- Links to raw artifacts

---

## 17. Security Design

Repository content and issue text are untrusted. A repository may include instructions attempting to make the agent disclose credentials or execute unsafe commands.

Required controls:

- Separate orchestration process from task container.
- Never mount the host Docker socket inside a task container.
- Mount the task workspace with only required permissions.
- Use ephemeral credentials and keep them outside the repository filesystem.
- Redact known secret patterns before trace persistence.
- Restrict commands to the workspace and enforce timeouts.
- Set CPU, memory, process, and disk quotas.
- Disable privileged containers.
- Record and visibly label any task that requires network access.
- Prevent the web dashboard from rendering raw HTML or executable repository content.
- Escape terminal output and diffs in the browser.

Security hardening itself can become a secondary demonstration of the builder's AI-security interests, but it should support rather than replace the central agent-infrastructure project.

---

## 18. Technical Stack

### Recommended initial stack

- **Language:** TypeScript for orchestration and agent runtime
- **Analysis:** Python with Polars or pandas, SciPy, and scikit-learn
- **Frontend:** Next.js and React
- **Database:** DuckDB for experiment analysis, optionally SQLite for application metadata
- **Validation:** Zod schemas
- **Tracing:** OpenTelemetry-compatible span model or a minimal compatible internal implementation
- **Sandbox:** Docker plus Git worktrees
- **Diffs:** Git-native diffs and a browser diff viewer
- **Parsing:** Tree-sitter where structural analysis adds value
- **Testing:** Vitest/Jest for TypeScript and pytest for Python
- **Automation:** GitHub Actions
- **Morph integration:** Official Morph SDK or documented API

### Design principle

Do not add infrastructure merely because it sounds impressive. A small, well-tested system using DuckDB is better than an unnecessary distributed stack. Technical credibility should come from experimental rigor, clean interfaces, reliability, and useful findings.

---

## 19. API and Interface Sketches

```ts
interface SearchProvider {
  search(input: SearchRequest, ctx: RunContext): Promise<SearchResult>;
}

interface EditProvider {
  apply(input: EditRequest, ctx: RunContext): Promise<EditResult>;
}

interface ContextProvider {
  shouldCompact(state: AgentState, ctx: RunContext): Promise<CompactionDecision>;
  compact(state: AgentState, decision: CompactionDecision): Promise<AgentState>;
}

interface Sandbox {
  prepare(task: BenchmarkTask): Promise<SandboxHandle>;
  exec(command: CommandRequest): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  collectDiff(): Promise<DiffArtifact>;
  dispose(): Promise<void>;
}

interface Controller {
  selectSearch(input: SearchDecisionInput): Promise<RoutingDecision>;
  selectEdit(input: EditDecisionInput): Promise<RoutingDecision>;
  selectContextAction(input: ContextDecisionInput): Promise<RoutingDecision>;
}
```

Every `RoutingDecision` should include the chosen action, feature values, policy version, and a short machine-readable reason. This makes the adaptive system auditable.

---

## 20. Experiment Design

### 20.1 Controlled variables

When testing one component, hold the following constant where possible:

- Reasoning model
- System prompt
- Maximum turns
- Token and cost budgets
- Repository commit
- Test command
- Sandbox resources
- Retry policy

### 20.2 Initial ablation matrix

Do not begin with every possible combination. Use staged experiments.

**Experiment A: Search**

- Standard search
- WarpGrep
- Adaptive search

Keep editing and context policy fixed.

**Experiment B: Editing**

- Deterministic/unified-diff baseline
- Full-file generation where needed
- Fast Apply
- Adaptive editing

Use the same retrieved context.

**Experiment C: Context**

- No compaction within safe task limits
- Simple threshold truncation
- Fixed-threshold Compact
- Adaptive Compact

Use tasks long enough for context management to matter.

**Experiment D: End-to-end**

- Credible conventional baseline
- Full Morph pipeline
- Adaptive MorphScope pipeline

### 20.3 Repetition

Start with one run per configuration while debugging. For published findings, repeat nondeterministic configurations enough times to expose variance, subject to budget. Report the number of trials.

### 20.4 Avoiding biased conclusions

- Define metrics before reviewing final results.
- Preserve failed runs.
- Do not silently remove tasks that make a favored system look worse.
- Document exclusions and environment failures.
- Keep prompts equivalent across configurations.
- Disclose when providers expose different capabilities.

---

## 21. Milestones

### Milestone 0: Technical spike

**Duration:** 2-3 days

- Verify Morph API access.
- Run one WarpGrep search.
- Run one Fast Apply edit.
- Run one Compact request.
- Confirm usage and cost metadata available from each path.
- Decide which reasoning-model provider to use.

**Exit criterion:** Each external component works independently, and any unavailable metadata is documented.

### Milestone 1: Minimal benchmark runner

**Duration:** Week 1

- Define task schema.
- Build controlled fixture repository.
- Prepare clean workspace per run.
- Implement baseline agent tools.
- Run task and evaluate tests.
- Save structured JSON trace.

**Exit criterion:** A single command runs one task from a clean checkout and stores a reproducible result.

### Milestone 2: Search study

**Duration:** Week 2

- Add WarpGrep adapter.
- Add search-specific spans and metrics.
- Create 10 controlled and real tasks.
- Run baseline-versus-WarpGrep experiment.
- Build a basic result-summary page.

**Exit criterion:** Produce the first honest comparison of retrieval quality, latency, cost, and downstream success.

### Milestone 3: Editing study

**Duration:** Weeks 3-4

- Add Fast Apply adapter.
- Implement edit validation and rollback.
- Capture before/after hashes and diffs.
- Expand to 25-30 tasks.
- Add trace replay and run comparison.

**Exit criterion:** Demonstrate when minimal semantic edit application helps and document failure cases.

### Milestone 4: Context study

**Duration:** Week 5

- Add context accounting.
- Implement baseline truncation.
- Add Compact adapter.
- Design long-running tasks.
- Measure information retention and downstream results.

**Exit criterion:** Quantify the tradeoff between context reduction, cost, latency, and success.

### Milestone 5: Adaptive routing

**Duration:** Weeks 6-7

- Implement transparent rule-based controller.
- Record routing features and reasons.
- Calculate offline oracle performance.
- Train an interpretable learned policy if enough data exists.
- Evaluate on held-out repositories.

**Exit criterion:** Determine whether adaptive tool selection improves the correctness/cost/latency frontier over always-on configurations.

### Milestone 6: Publication and outreach

**Duration:** Week 8

- Clean public repository.
- Complete methodology and security documentation.
- Publish raw results that can be safely shared.
- Write technical report.
- Deploy read-only dashboard.
- Record a 90-second demo and a 5-minute technical walkthrough.
- Contact Tejas with one or two specific findings.

**Exit criterion:** A third party can understand, run, inspect, and critique the project.

---

## 22. MVP Definition

The MVP is complete when it has:

- 10 reproducible tasks across at least two repositories or controlled fixtures
- A credible baseline agent
- WarpGrep integration
- Fast Apply integration
- Automated test evaluation
- Structured trace storage
- Search, edit, latency, token, cost, and success metrics
- A web page showing an experiment summary
- A trace page showing search, edits, tests, and timing
- Side-by-side comparison of two runs
- Documented methodology and limitations

Compact and adaptive routing are valuable but should not delay a working search-and-edit evaluation.

---

## 23. Acceptance Criteria

### Runner

- A task starts from the exact configured commit.
- Two runs cannot accidentally share modified repository state.
- Timeouts leave a readable partial trace.
- The final patch and test output are stored.
- Run status distinguishes success, task failure, infrastructure error, provider error, and timeout.

### Tracing

- Every search, model call, edit, command, and test has start/end time and status.
- Token and cost data are stored where providers expose them.
- Secrets are not visible in persisted traces.
- Controller decisions include reasons.

### Evaluation

- Passing tests are required for task resolution.
- Syntax-invalid changes cannot be marked successful.
- Environment failures are excluded from task-quality metrics but reported separately.
- Reference-patch comparison does not override behavioral tests.

### Dashboard

- A viewer can identify the winning configuration for a task.
- A viewer can see why two runs diverged.
- Diffs and terminal output render safely.
- Summary metrics link back to underlying runs.

### Reproducibility

- The repository contains setup and execution instructions.
- Every published chart can be regenerated from saved results.
- Published results identify task set, model, prompt, configuration, and date.

---

## 24. Risks and Mitigations

### Risk: Scope becomes too large

**Mitigation:** Complete the search study before adding editing, compaction, learned routing, or elaborate UI work.

### Risk: Project looks like an API wrapper

**Mitigation:** Emphasize controlled ablations, trace instrumentation, failure analysis, reproducibility, and adaptive decisions.

### Risk: Too few tasks for credible conclusions

**Mitigation:** Label early work as a pilot. Publish raw results and avoid broad statistical claims.

### Risk: Benchmark environment dominates failures

**Mitigation:** Begin with controlled fixtures, cache dependencies, version container images, and classify environment failures separately.

### Risk: API cost grows rapidly

**Mitigation:** Develop with mock providers and short fixtures, set hard cost limits, cache immutable artifacts where permitted, and increase repetitions only for publication candidates.

### Risk: Model nondeterminism obscures component effects

**Mitigation:** Use paired tasks, repeated trials, equivalent prompts, fixed model versions, and variance reporting.

### Risk: Adaptive controller overfits

**Mitigation:** Begin with interpretable rules and evaluate learned policies on repositories excluded from training.

### Risk: Unsafe repository code

**Mitigation:** Enforce sandbox isolation, no host credentials, restricted network, resource limits, and untrusted-content handling.

### Risk: Results criticize the company being approached

**Mitigation:** Report failures respectfully and precisely. A carefully reproduced limitation can be more valuable than flattering but weak results.

---

## 25. Demo Plan

### 90-second founder demo

1. State the question: when should a coding agent use specialized search and editing tools?
2. Select one cross-file repository task.
3. Start or replay baseline and MorphScope runs side by side.
4. Show search divergence and time to relevant code.
5. Show context growth and generated patches.
6. Show tests and final outcome.
7. Display aggregate results and one surprising failure pattern.
8. End with the adaptive controller's decision and measured effect.

### Five-minute technical walkthrough

- Architecture and provider interfaces
- Task reproducibility
- Trace schema
- Experiment controls
- One successful case
- One failure case
- Adaptive-routing methodology
- Limitations and next experiment

The demo should use previously captured traces so network or provider variability does not ruin the presentation. A live run can be offered separately.

---

## 26. Deliverables

- Public GitHub repository
- Hosted read-only dashboard
- Ten or more reproducible MVP tasks
- Raw trace dataset with safe redactions
- Benchmark summary
- Technical report
- Architecture diagram
- Methodology and limitations documents
- 90-second demo video
- Five-minute technical walkthrough
- Resume project entry
- Personalized outreach email to Tejas Bhakta

---

## 27. Resume Positioning

Do not list unverified performance improvements. Replace brackets only after experiments produce real results.

**Example project title**

`MorphScope - Open-Source Coding-Agent Profiler and Adaptive Router`

**Example bullets**

- Built a reproducible coding-agent evaluation platform that profiles repository search, code application, context management, testing, latency, token usage, and cost across real GitHub tasks.
- Integrated Morph WarpGrep, Fast Apply, and Compact behind pluggable TypeScript interfaces and compared them with conventional baselines through controlled ablation experiments.
- Designed an adaptive routing policy using repository, task, and runtime features to select search and editing strategies, improving `[metric]` by `[verified result]` on held-out repositories.
- Developed sandboxed task execution, structured trace replay, automated failure classification, and a Next.js dashboard for side-by-side analysis of agent runs.

---

## 28. Outreach Strategy

Do not contact Tejas merely to announce that an API integration exists. Contact him when at least the search study works and there is one non-obvious, defensible finding.

The outreach should contain:

1. One sentence about the shared motel-family background.
2. One sentence explaining MorphScope.
3. One concrete experimental finding.
4. Links to the repository, demo, and short report.
5. A request for technical feedback.
6. Only then, an indication of interest in contributing through a small trial project or internship.

Example positioning:

> I built MorphScope, an open-source profiler for coding-agent search, editing, and context management. I ran paired experiments comparing conventional tools with WarpGrep and Fast Apply, then used the traces to identify when specialized routing helped or added overhead. One result I did not expect was [verified finding]. I would value your feedback on the methodology and would be interested in extending the work through a small trial project with Morph.

---

## 29. Open Questions

Resolve these during the technical spike rather than guessing:

- Which reasoning-model provider and model will be used?
- What API credits and experiment budget are available?
- Which Morph endpoints expose reliable usage metadata?
- Does the initial version require Compact, or should it remain a post-MVP study?
- Which two languages should the first real-repository tasks cover?
- Can third-party benchmark tasks be redistributed under their licenses?
- Which sandbox approach works reliably on the development machine and deployment environment?
- How will hidden evaluation tests be protected in a public repository?
- Should raw model responses be public, redacted, or summarized?
- How many repeated trials are affordable for the final report?

---

## 30. Immediate Next Actions

1. Create the monorepo and core schemas.
2. Confirm Morph API access and run one request through each proposed component.
3. Build one small TypeScript fixture repository with three tasks.
4. Implement the sandbox and baseline tools.
5. Define the trace schema before building the dashboard.
6. Run the first baseline task end to end.
7. Add WarpGrep without changing other variables.
8. Compare the two traces manually.
9. Add automated retrieval and latency metrics.
10. Build the first simple comparison screen.

The first meaningful checkpoint is not a polished website. It is two valid traces of the same task, run from clean environments, with only the search strategy changed.

---

## 31. Handoff Prompt for a New Chat

Copy the following prompt into a new chat together with this PRD:

```text
I am building MorphScope, an open-source coding-agent evaluation, profiling, and adaptive routing platform. The attached PRD is the authoritative project specification.

My long-term goal is to build a technically impressive project closely relevant to Morph and use its findings to approach founder Tejas Bhakta about an internship or small trial project. I am a Georgia Tech computer science student interested in AI and security.

Please read the entire PRD before recommending or changing anything. Preserve its central product thesis: this is not a generic coding assistant or a simple Morph API wrapper. It must be a reproducible evaluation system that compares conventional agent tools with WarpGrep, Fast Apply, Compact, and eventually adaptive routing.

Start by helping me execute Milestone 0 and Milestone 1. Before writing substantial code:

1. Check the current official Morph documentation for API and SDK changes.
2. Inspect my local development environment and existing repository, if one exists.
3. Identify the smallest vertical slice that can run one task from a clean repository state, capture a structured trace, apply a change, execute tests, and save the result.
4. Propose a short implementation plan and explain unfamiliar concepts briefly.
5. Keep the architecture extensible, but do not overengineer the MVP.
6. Never invent benchmark results or hardcode successful outputs.
7. Test each completed stage before moving to the next one.

When a decision is not specified in the PRD, recommend one option with a clear technical reason and note the tradeoff.
```

---

## 32. Reference Material

- Morph overview and current product direction: https://www.morphllm.com/about
- Morph WarpGrep documentation: https://docs.morphllm.com/sdk/components/warp-grep
- Morph Fast Apply documentation: https://docs.morphllm.com/sdk/components/fast-apply
- Morph Compact documentation: https://docs.morphllm.com/sdk/components/compact
- WarpGrep v2 technical article: https://www.morphllm.com/blog/warpgrep-v2
- Morph code-generation inference research: https://www.morphllm.com/blog/codegen-inference-research
- Morph coding-agent harness lessons: https://www.morphllm.com/blog/coding-agent-harness-lessons

API behavior, product availability, pricing, model names, and benchmark claims can change. Verify current official documentation before implementation or publication.

