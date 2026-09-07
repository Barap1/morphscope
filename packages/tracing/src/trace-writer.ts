import { randomUUID } from "node:crypto";
import {
  SpanSchema,
  type Span,
  type SpanError,
  type SpanStatus,
  type TokenUsage,
} from "@morphscope/schemas";
import { z } from "zod";
import { redactSecrets } from "./redaction.js";

const TraceEventSchema = z.object({
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1).nullable(),
  type: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  attributes: z.record(z.string(), z.unknown()),
});

export type TraceSpan = Span;
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export type TraceSnapshot = {
  traceId: string;
  run?: Record<string, unknown>;
  spans: Record<string, unknown>[];
  events: Record<string, unknown>[];
};

export type TracePersistence = {
  upsertSpan(span: TraceSpan): void | Promise<void>;
  appendEvent(event: TraceEvent): void | Promise<void>;
  readTrace(traceId: string): TraceSnapshot | Promise<TraceSnapshot>;
};

export type SpanUpdate = {
  attributes?: Record<string, unknown>;
  inputArtifactIds?: string[];
  outputArtifactIds?: string[];
  tokenUsage?: TokenUsage | null;
  cost?: number | null;
};

export type SpanHandle = {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  update(update: SpanUpdate): void;
  end(status?: Exclude<SpanStatus, "running">, error?: SpanError): void;
  event(type: string, attributes?: Record<string, unknown>): void;
};

export class TraceWriter {
  readonly traceId: string;
  private readonly persistence: TracePersistence;
  private readonly now: () => string;
  private readonly openSpans = new Map<string, Span>();
  private readonly activeSpanIds: string[] = [];

  constructor(options: { traceId?: string; persistence: TracePersistence; now?: () => string }) {
    this.traceId = options.traceId ?? randomUUID();
    this.persistence = options.persistence;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  startSpan(
    type: string,
    options: {
      attributes?: Record<string, unknown>;
      parentSpanId?: string;
      inputArtifactIds?: string[];
      outputArtifactIds?: string[];
      tokenUsage?: TokenUsage | null;
      cost?: number | null;
    } = {},
  ): SpanHandle {
    const resolvedParent = options.parentSpanId ?? this.activeSpanIds.at(-1) ?? null;
    if (resolvedParent && !this.openSpans.has(resolvedParent)) {
      throw new Error(`cannot nest span under unknown parent: ${resolvedParent}`);
    }

    const span = SpanSchema.parse({
      spanId: randomUUID(),
      traceId: this.traceId,
      parentSpanId: resolvedParent,
      type,
      start: this.now(),
      end: null,
      status: "running",
      inputArtifactIds: options.inputArtifactIds ?? [],
      outputArtifactIds: options.outputArtifactIds ?? [],
      tokenUsage: options.tokenUsage ?? null,
      cost: options.cost ?? null,
      attributes: normalizeAttributes(options.attributes ?? {}),
      error: null,
    });
    this.openSpans.set(span.spanId, span);
    this.activeSpanIds.push(span.spanId);
    this.persistence.upsertSpan(span);

    let ended = false;
    return {
      spanId: span.spanId,
      traceId: span.traceId,
      parentSpanId: span.parentSpanId,
      update: (update) => {
        if (ended) throw new Error(`cannot update an ended span: ${span.spanId}`);
        this.updateSpan(span.spanId, update);
      },
      end: (status = "ok", error) => {
        if (ended) throw new Error(`span already ended: ${span.spanId}`);
        ended = true;
        this.finishSpan(span.spanId, status, error);
      },
      event: (eventType, eventAttributes = {}) => {
        if (ended) throw new Error(`cannot add an event to an ended span: ${span.spanId}`);
        this.recordEvent(span.spanId, eventType, eventAttributes);
      },
    };
  }

  recordEvent(
    spanId: string | null,
    type: string,
    attributes: Record<string, unknown> = {},
  ): TraceEvent {
    if (spanId !== null && !this.openSpans.has(spanId)) {
      throw new Error(`cannot attach event to unknown span: ${spanId}`);
    }
    const event = TraceEventSchema.parse({
      eventId: randomUUID(),
      traceId: this.traceId,
      spanId,
      type,
      occurredAt: this.now(),
      attributes: redactSecrets(attributes),
    });
    this.persistence.appendEvent(event);
    return event;
  }

  read(): TraceSnapshot | Promise<TraceSnapshot> {
    return this.persistence.readTrace(this.traceId);
  }

  private updateSpan(spanId: string, update: SpanUpdate): void {
    const current = this.openSpans.get(spanId);
    if (!current) throw new Error(`unknown span: ${spanId}`);
    const next = SpanSchema.parse({
      ...current,
      ...(update.attributes ? { attributes: normalizeAttributes(update.attributes) } : {}),
      ...(update.inputArtifactIds ? { inputArtifactIds: update.inputArtifactIds } : {}),
      ...(update.outputArtifactIds ? { outputArtifactIds: update.outputArtifactIds } : {}),
      ...(update.tokenUsage !== undefined ? { tokenUsage: update.tokenUsage } : {}),
      ...(update.cost !== undefined ? { cost: update.cost } : {}),
    });
    this.openSpans.set(spanId, next);
    this.persistence.upsertSpan(next);
  }

  private finishSpan(
    spanId: string,
    status: Exclude<SpanStatus, "running">,
    error?: SpanError,
  ): void {
    const current = this.openSpans.get(spanId);
    if (!current) throw new Error(`unknown span: ${spanId}`);
    const next = SpanSchema.parse({
      ...current,
      end: this.now(),
      status,
      error: error ? redactSecrets(error) : null,
    });
    this.openSpans.delete(spanId);
    const activeIndex = this.activeSpanIds.indexOf(spanId);
    if (activeIndex >= 0) this.activeSpanIds.splice(activeIndex, 1);
    this.persistence.upsertSpan(next);
  }
}

export class TraceReader {
  constructor(private readonly persistence: Pick<TracePersistence, "readTrace">) {}

  read(traceId: string): TraceSnapshot | Promise<TraceSnapshot> {
    if (!traceId.trim()) throw new Error("traceId must be a non-empty string");
    return this.persistence.readTrace(traceId);
  }
}

function normalizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSecrets(attributes);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
    } else {
      normalized[key] = JSON.stringify(value);
    }
  }
  return normalized;
}
