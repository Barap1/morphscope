import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_GROQ_MODEL,
  GroqClient,
  GroqProviderError,
  type GroqCompletionResult,
} from "@morphscope/providers";
import { SqliteTraceStore } from "@morphscope/storage";
import { redactSecrets, TraceWriter } from "@morphscope/tracing";

async function main(): Promise<void> {
  const runId = randomUUID();
  const traceId = randomUUID();
  const outputRoot = resolve(join(process.cwd(), ".morphscope", "groq-smoke", runId));
  mkdirSync(outputRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(outputRoot, "trace.sqlite") });
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("groq_smoke", {
    attributes: { provider: "groq", model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL },
  });
  try {
    const client = new GroqClient({ trace });
    const result = await client.complete({
      messages: [
        {
          role: "user",
          content: "Reply with exactly one short sentence: why is latency useful to measure?",
        },
      ],
      temperature: 0,
      maxCompletionTokens: 48,
    });
    rootSpan.event("groq_smoke_completed", {
      provider: result.metadata.provider,
      model: result.metadata.model,
      status: result.metadata.status,
      latencyMs: result.metadata.latencyMs,
      usage: result.metadata.usage,
      responseLength: result.content.length,
    });
    rootSpan.end("ok");
    writeResult(outputRoot, runId, traceId, result);
    console.log(JSON.stringify({ runId, traceId, outputRoot }, null, 2));
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)) as string;
    rootSpan.event("groq_smoke_error", {
      provider: "groq",
      errorCode: error instanceof GroqProviderError ? error.code : "unknown",
      message,
    });
    rootSpan.end("error", {
      category: "provider_failure",
      ...(error instanceof GroqProviderError ? { code: error.code } : {}),
      message: message.length >= 8 ? message : "Groq provider error: " + message,
    });
    writeFileSync(
      join(outputRoot, "error.json"),
      JSON.stringify(
        redactSecrets({
          runId,
          traceId,
          provider: "groq",
          model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
          error: message,
          errorCode: error instanceof GroqProviderError ? error.code : "unknown",
          trace: trace.read(),
        }),
        null,
        2,
      ),
    );
    throw error;
  } finally {
    traceStore.close();
  }
}

function writeResult(
  outputRoot: string,
  runId: string,
  traceId: string,
  result: GroqCompletionResult,
): void {
  const responseHash = createHash("sha256").update(result.content, "utf8").digest("hex");
  writeFileSync(
    join(outputRoot, "result.json"),
    JSON.stringify(
      redactSecrets({
        runId,
        traceId,
        provider: result.metadata.provider,
        model: result.metadata.model,
        status: result.metadata.status,
        latencyMs: result.metadata.latencyMs,
        usage: result.metadata.usage,
        rateLimit: result.metadata.rateLimit,
        finishReason: result.finishReason,
        responseLength: result.content.length,
        responseSha256: responseHash,
      }),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    "Groq smoke failed: " + redactSecrets(error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
});
