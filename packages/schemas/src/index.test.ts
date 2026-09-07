import { describe, expect, it } from "vitest";

import {
  ArtifactManifestSchema,
  ExperimentSchema,
  RoutingDecisionSchema,
  RunSchema,
  SpanSchema,
  TaskSchema,
} from "./index";

const timestamp = "2026-09-07T12:00:00.000Z";

const validTask = {
  id: "task-001",
  repository: "https://github.com/example/repository.git",
  commit: "abc1234",
  issue: "Fix the parser error reported by the failing fixture.",
  setup: "pnpm install --frozen-lockfile",
  evaluation: "pnpm test",
  resourceLimits: {
    maxDurationMs: 120_000,
    maxTotalTokens: 20_000,
    maxCostUsd: 5,
    maxTurns: 20,
  },
  tags: ["parser", "fixture"],
  metadata: {
    difficulty: "small",
    stage: 1,
    hasReferencePatch: true,
  },
};

const validRun = {
  id: "run-001",
  experimentId: "experiment-001",
  taskId: "task-001",
  configurationId: "baseline",
  traceId: "trace-001",
  repositoryCommit: "abc1234",
  MorphScopeCommit: "def5678",
  provider: "example-provider",
  model: "example-model",
  startedAt: timestamp,
  completedAt: timestamp,
  terminalState: "resolved" as const,
  totalLatency: 12_345.5,
  totalInputTokens: 1_200,
  totalOutputTokens: 800,
  totalCost: 0.42,
  score: 1,
  artifactIds: ["artifact-patch"],
  environmentManifest: {
    image: "morphscope-runner:2026-09-07",
    toolVersions: { node: "24.18.0", pnpm: "11.25.0" },
  },
};

const validSpan = {
  spanId: "span-001",
  traceId: "trace-001",
  parentSpanId: null,
  type: "model_call",
  start: timestamp,
  end: "2026-09-07T12:00:01.000Z",
  status: "ok" as const,
  inputArtifactIds: ["artifact-prompt"],
  outputArtifactIds: ["artifact-response"],
  tokenUsage: {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
  },
  cost: 0.02,
  attributes: { provider: "example-provider", retry: false },
  error: null,
};

describe("core schemas", () => {
  it("accepts representative task, run, span, routing, experiment, and artifact data", () => {
    expect(TaskSchema.safeParse(validTask).success).toBe(true);
    expect(
      ExperimentSchema.safeParse({
        id: "experiment-001",
        name: "Baseline parser study",
        description: "Compare baseline runs on the parser fixture.",
        taskSetVersion: "fixtures-v1",
        sourceCommit: "def5678",
        configurationMatrix: [
          {
            id: "baseline",
            name: "Baseline",
            searchProvider: "ripgrep",
            editProvider: "unified_diff",
            contextProvider: "none",
          },
        ],
        createdAt: timestamp,
        status: "ready",
      }).success,
    ).toBe(true);
    expect(RunSchema.safeParse(validRun).success).toBe(true);
    expect(SpanSchema.safeParse(validSpan).success).toBe(true);
    expect(
      RoutingDecisionSchema.safeParse({
        providerCategory: "search",
        candidateActions: ["ripgrep", "warpgrep"],
        selectedAction: "ripgrep",
        featureVector: { queryLength: 3, exactIdentifier: 1 },
        humanReadableReason: "The query contains an exact identifier.",
        machineReadableReason: { code: "exact_identifier", factors: ["exact_match"] },
        policyVersion: "rules-v1",
        remainingBudgets: { durationMs: 60_000, totalTokens: 10_000 },
      }).success,
    ).toBe(true);
    expect(
      ArtifactManifestSchema.safeParse({
        sha256: "a".repeat(64),
        mimeType: "text/plain",
        size: 128,
        storagePath:
          "artifacts/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        redactionStatus: "not_redacted",
        producerSpanId: "span-001",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed tasks instead of stripping unknown or invalid data", () => {
    expect(TaskSchema.safeParse({ ...validTask, resourceLimits: {} }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, tags: ["duplicate", "duplicate"] }).success).toBe(
      false,
    );
    expect(TaskSchema.safeParse({ ...validTask, unexpected: "payload" }).success).toBe(false);
    expect(
      TaskSchema.safeParse({ ...validTask, metadata: { nested: { unsafe: true } } }).success,
    ).toBe(false);
  });

  it("rejects malformed runs, including invalid terminal states and time order", () => {
    expect(RunSchema.safeParse({ ...validRun, terminalState: "finished" }).success).toBe(false);
    expect(
      RunSchema.safeParse({ ...validRun, completedAt: "2026-09-07T11:59:59.000Z" }).success,
    ).toBe(false);
    expect(RunSchema.safeParse({ ...validRun, totalCost: Number.NaN }).success).toBe(false);
    expect(
      RunSchema.safeParse({ ...validRun, secretPayload: { token: "redact-me" } }).success,
    ).toBe(false);
  });

  it("rejects malformed spans, including invalid nesting timestamps and payloads", () => {
    expect(SpanSchema.safeParse({ ...validSpan, end: "2026-09-07T11:59:59.000Z" }).success).toBe(
      false,
    );
    expect(SpanSchema.safeParse({ ...validSpan, parentSpanId: { id: "span-000" } }).success).toBe(
      false,
    );
    expect(
      SpanSchema.safeParse({
        ...validSpan,
        attributes: { nested: { unvalidated: "object" } },
      }).success,
    ).toBe(false);
    expect(SpanSchema.safeParse({ ...validSpan, unknownField: true }).success).toBe(false);
  });
});
