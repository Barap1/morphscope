import { z } from "zod";

const MAX_ID_LENGTH = 256;
const MAX_METADATA_ENTRIES = 64;

const NonEmptyString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, "Value must contain a non-whitespace character");

const IdentifierSchema = NonEmptyString(MAX_ID_LENGTH).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
  "Identifier contains unsupported characters",
);

const KeySchema = NonEmptyString(96).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  "Key contains unsupported characters",
);

const TimestampSchema = z.iso.datetime({ offset: true });
const NonNegativeIntegerSchema = z.number().int().min(0).max(1_000_000_000_000);
const PositiveIntegerSchema = NonNegativeIntegerSchema.min(1);
const NonNegativeNumberSchema = z.number().finite().min(0).max(1_000_000_000_000);
const ScoreSchema = NonNegativeNumberSchema;

const MetadataValueSchema = z.union([
  z.string().max(8_192),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const BoundedMetadataSchema = z
  .record(KeySchema, MetadataValueSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_METADATA_ENTRIES,
    `Metadata cannot contain more than ${MAX_METADATA_ENTRIES} entries`,
  );

const ArtifactReferenceSchema = IdentifierSchema;

/** Resource ceilings applied to one benchmark task. */
export const ResourceLimitsSchema = z
  .object({
    maxDurationMs: PositiveIntegerSchema.optional(),
    maxInputTokens: PositiveIntegerSchema.optional(),
    maxOutputTokens: PositiveIntegerSchema.optional(),
    maxTotalTokens: PositiveIntegerSchema.optional(),
    maxCostUsd: NonNegativeNumberSchema.optional(),
    maxNominalCostUsd: NonNegativeNumberSchema.optional(),
    maxTurns: PositiveIntegerSchema.optional(),
    maxMemoryMb: PositiveIntegerSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((limit) => limit !== undefined),
    "At least one resource limit is required",
  );

export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

/** A named configuration in an experiment's matrix. */
export const ConfigurationSchema = z
  .object({
    id: IdentifierSchema,
    name: NonEmptyString(128).optional(),
    provider: NonEmptyString(128).optional(),
    model: NonEmptyString(256).optional(),
    searchProvider: NonEmptyString(128).optional(),
    editProvider: NonEmptyString(128).optional(),
    contextProvider: NonEmptyString(128).optional(),
    options: BoundedMetadataSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.provider !== undefined ||
      value.model !== undefined ||
      value.searchProvider !== undefined ||
      value.editProvider !== undefined ||
      value.contextProvider !== undefined,
    "A configuration needs a name or at least one provider setting",
  );

export type Configuration = z.infer<typeof ConfigurationSchema>;

export const ConfigurationMatrixSchema = z.array(ConfigurationSchema).min(1).max(64);
export type ConfigurationMatrix = z.infer<typeof ConfigurationMatrixSchema>;

export const ExperimentSchema = z
  .object({
    id: IdentifierSchema,
    name: NonEmptyString(256),
    description: NonEmptyString(16_384),
    taskSetVersion: NonEmptyString(128),
    sourceCommit: NonEmptyString(128),
    configurationMatrix: ConfigurationMatrixSchema,
    createdAt: TimestampSchema,
    status: NonEmptyString(32),
  })
  .strict();

export type Experiment = z.infer<typeof ExperimentSchema>;

export const TaskSchema = z
  .object({
    id: IdentifierSchema,
    repository: NonEmptyString(2_048),
    commit: NonEmptyString(128),
    issue: NonEmptyString(50_000),
    setup: NonEmptyString(16_384),
    evaluation: NonEmptyString(16_384),
    resourceLimits: ResourceLimitsSchema,
    tags: z
      .array(NonEmptyString(64))
      .max(64)
      .refine((tags) => new Set(tags).size === tags.length, "Task tags must be unique"),
    metadata: BoundedMetadataSchema,
  })
  .strict();

export type Task = z.infer<typeof TaskSchema>;

export const TerminalStateSchema = z.enum([
  "resolved",
  "task_failed",
  "provider_error",
  "environment_error",
  "timeout",
  "budget_exhausted",
  "cancelled",
]);

export const TERMINAL_STATES = TerminalStateSchema.options;
export type TerminalState = z.infer<typeof TerminalStateSchema>;

export const FailureCategorySchema = z.enum([
  "environment_failure",
  "provider_failure",
  "retrieval_failure",
  "interpretation_failure",
  "planning_failure",
  "generation_failure",
  "application_failure",
  "verification_failure",
  "regression",
  "context_loss_failure",
  "loop_stagnation",
  "budget_exhaustion",
]);

export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const FailureConfidenceSchema = z.enum(["high", "medium", "low"]);
export type FailureConfidence = z.infer<typeof FailureConfidenceSchema>;

export const FailureClassificationSchema = z
  .object({
    category: FailureCategorySchema.nullable(),
    confidence: FailureConfidenceSchema,
    reason: NonEmptyString(8_192),
  })
  .strict();

export type FailureClassification = z.infer<typeof FailureClassificationSchema>;

export const ManualFailureCorrectionSchema = z
  .object({
    category: FailureCategorySchema.nullable(),
    reason: NonEmptyString(8_192),
    correctedAt: TimestampSchema,
  })
  .strict();

export type ManualFailureCorrection = z.infer<typeof ManualFailureCorrectionSchema>;

export const AnalysisMetadataSchema = z
  .object({
    automatic: FailureClassificationSchema,
    manualCorrection: ManualFailureCorrectionSchema.nullable(),
  })
  .strict();

export type AnalysisMetadata = z.infer<typeof AnalysisMetadataSchema>;

const EnvironmentManifestSchema = z
  .object({
    image: NonEmptyString(512).optional(),
    platform: NonEmptyString(128).optional(),
    runtime: NonEmptyString(128).optional(),
    toolVersions: z
      .record(KeySchema, NonEmptyString(128))
      .refine(
        (value) => Object.keys(value).length <= MAX_METADATA_ENTRIES,
        `Tool version manifest cannot contain more than ${MAX_METADATA_ENTRIES} entries`,
      )
      .optional(),
    seed: z.union([NonEmptyString(256), NonNegativeIntegerSchema]).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    "Environment manifest cannot be empty",
  );

export type EnvironmentManifest = z.infer<typeof EnvironmentManifestSchema>;

export const CostBasisSchema = z.enum([
  "provider_reported",
  "nominal_estimate",
  "free_tier_covered",
  "unavailable",
]);
export type CostBasis = z.infer<typeof CostBasisSchema>;
export const CostCoverageSchema = z.enum(["free_tier", "paid", "unknown", "not_applicable"]);
export type CostCoverage = z.infer<typeof CostCoverageSchema>;

export const RunSchema = z
  .object({
    id: IdentifierSchema,
    experimentId: IdentifierSchema,
    taskId: IdentifierSchema,
    configurationId: IdentifierSchema,
    traceId: IdentifierSchema,
    repositoryCommit: NonEmptyString(128),
    MorphScopeCommit: NonEmptyString(128),
    provider: NonEmptyString(128),
    model: NonEmptyString(256),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.nullable(),
    terminalState: TerminalStateSchema,
    totalLatency: NonNegativeNumberSchema,
    totalInputTokens: NonNegativeIntegerSchema,
    totalOutputTokens: NonNegativeIntegerSchema,
    totalCost: NonNegativeNumberSchema,
    costBasis: CostBasisSchema.optional(),
    costCoverage: CostCoverageSchema.optional(),
    score: ScoreSchema.nullable().optional(),
    failureCategory: FailureCategorySchema.nullable().optional(),
    analysisMetadata: AnalysisMetadataSchema.optional(),
    finalPatchArtifactId: ArtifactReferenceSchema.nullable().optional(),
    artifactIds: z.array(ArtifactReferenceSchema).max(256).optional(),
    environmentManifest: EnvironmentManifestSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.completedAt === null || Date.parse(value.completedAt) >= Date.parse(value.startedAt),
    "Run completion cannot precede run start",
  );

export type Run = z.infer<typeof RunSchema>;

export const TokenUsageSchema = z
  .object({
    inputTokens: NonNegativeIntegerSchema,
    outputTokens: NonNegativeIntegerSchema,
    totalTokens: NonNegativeIntegerSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.totalTokens === undefined ||
      value.totalTokens >= value.inputTokens + value.outputTokens,
    "Total tokens cannot be lower than input plus output tokens",
  );

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const SpanStatusSchema = z.enum(["running", "ok", "completed", "error", "cancelled"]);
export type SpanStatus = z.infer<typeof SpanStatusSchema>;

const SpanErrorSchema = z
  .object({
    category: FailureCategorySchema,
    message: NonEmptyString(8_192),
    code: NonEmptyString(128).optional(),
  })
  .strict();

export type SpanError = z.infer<typeof SpanErrorSchema>;

const SpanAttributesSchema = z
  .record(KeySchema, MetadataValueSchema)
  .refine(
    (value) => Object.keys(value).length <= MAX_METADATA_ENTRIES,
    `Span attributes cannot contain more than ${MAX_METADATA_ENTRIES} entries`,
  );

export const SpanSchema = z
  .object({
    spanId: IdentifierSchema,
    traceId: IdentifierSchema,
    parentSpanId: IdentifierSchema.nullable(),
    type: NonEmptyString(96),
    start: TimestampSchema,
    end: TimestampSchema.nullable(),
    status: SpanStatusSchema,
    inputArtifactIds: z.array(ArtifactReferenceSchema).max(256),
    outputArtifactIds: z.array(ArtifactReferenceSchema).max(256),
    tokenUsage: TokenUsageSchema.nullable().optional(),
    cost: NonNegativeNumberSchema.nullable().optional(),
    attributes: SpanAttributesSchema.optional(),
    error: SpanErrorSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.end === null || Date.parse(value.end) >= Date.parse(value.start),
    "Span end cannot precede span start",
  );

export type Span = z.infer<typeof SpanSchema>;

const RemainingBudgetsSchema = z
  .object({
    durationMs: NonNegativeNumberSchema.optional(),
    inputTokens: NonNegativeIntegerSchema.optional(),
    outputTokens: NonNegativeIntegerSchema.optional(),
    totalTokens: NonNegativeIntegerSchema.optional(),
    costUsd: NonNegativeNumberSchema.optional(),
    turns: NonNegativeIntegerSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((budget) => budget !== undefined),
    "At least one remaining budget is required",
  );

const MachineReadableReasonSchema = z
  .object({
    code: KeySchema,
    factors: z.array(NonEmptyString(256)).max(32).optional(),
    details: BoundedMetadataSchema.optional(),
  })
  .strict();

export type MachineReadableReason = z.infer<typeof MachineReadableReasonSchema>;

export const RoutingDecisionSchema = z
  .object({
    providerCategory: z.enum(["search", "edit", "context"]),
    candidateActions: z
      .array(IdentifierSchema)
      .min(1)
      .max(32)
      .refine(
        (actions) => new Set(actions).size === actions.length,
        "Candidate actions must be unique",
      ),
    selectedAction: IdentifierSchema,
    featureVector: z
      .record(KeySchema, z.number().finite())
      .refine(
        (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 128,
        "Feature vector must contain between one and 128 features",
      ),
    humanReadableReason: NonEmptyString(2_048),
    machineReadableReason: MachineReadableReasonSchema,
    policyVersion: NonEmptyString(128),
    remainingBudgets: RemainingBudgetsSchema,
  })
  .strict()
  .refine(
    (value) => value.candidateActions.includes(value.selectedAction),
    "Selected action must be one of the candidate actions",
  );

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const ArtifactManifestSchema = z
  .object({
    sha256: z
      .string()
      .regex(/^[A-Fa-f0-9]{64}$/, "SHA-256 must be a 64-character hexadecimal hash"),
    mimeType: NonEmptyString(256),
    size: NonNegativeIntegerSchema,
    storagePath: NonEmptyString(4_096).refine(
      (value) => !value.includes("\u0000") && !/[\r\n]/.test(value),
      "Storage path cannot contain control characters",
    ),
    redactionStatus: NonEmptyString(64),
    producerSpanId: IdentifierSchema,
  })
  .strict();

export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
