import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { MorphClient } from "@morphscope/providers";
import { ContentAddressedArtifactStore, SqliteTraceStore } from "@morphscope/storage";
import { redactSecrets, TraceWriter } from "@morphscope/tracing";

type SpikeOptions = {
  repoRoot: string;
  file: string;
  search: string;
  instructions: string;
  codeEdit: string;
  query: string;
  only: "all" | "warpgrep" | "fast-apply" | "compact";
  output?: string;
};

function parseArgs(argv: string[]): SpikeOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) throw new Error(`expected an option, received ${key ?? "<end>"}`);
    const value = argv[++index];
    if (!value) throw new Error(`missing value for ${key}`);
    values.set(key.slice(2), value);
  }
  const file = values.get("file");
  const search = values.get("search");
  const instructions = values.get("instructions");
  const codeEdit = values.get("code-edit");
  const only = values.get("only") ?? "all";
  if (!file || !search || !instructions || !codeEdit) {
    throw new Error(
      "usage: pnpm morphscope:morph-spike --file <path> --search <query> --instructions <text> --code-edit <snippet> [--repo <dir>] [--query <text>] [--only all|warpgrep|fast-apply|compact]",
    );
  }
  if (!["all", "warpgrep", "fast-apply", "compact"].includes(only)) {
    throw new Error("--only must be all, warpgrep, fast-apply, or compact");
  }
  return {
    repoRoot: resolve(values.get("repo") ?? process.cwd()),
    file,
    search,
    instructions,
    codeEdit,
    query: values.get("query") ?? search,
    only: only as SpikeOptions["only"],
    output: values.get("output"),
  };
}

function safeFilePath(root: string, input: string): string {
  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("--file must remain inside --repo");
  }
  if (!existsSync(candidate)) throw new Error(`file does not exist: ${input}`);
  const realPath = realpathSync.native(candidate);
  const realRelativePath = relative(root, realPath);
  if (realRelativePath === ".." || realRelativePath.startsWith(`..${sep}`)) {
    throw new Error("--file symlink escapes --repo");
  }
  return realPath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runId = randomUUID();
  const traceId = randomUUID();
  const outputRoot = resolve(
    options.output ?? join(process.cwd(), ".morphscope", "morph-spike", runId),
  );
  mkdirSync(outputRoot, { recursive: true });
  const traceStore = new SqliteTraceStore({ filename: join(outputRoot, "trace.sqlite") });
  const artifacts = new ContentAddressedArtifactStore(join(outputRoot, "artifacts"));
  const trace = new TraceWriter({ traceId, persistence: traceStore });
  const rootSpan = trace.startSpan("morph_spike", { attributes: { runId } });
  try {
    const filePath = safeFilePath(options.repoRoot, options.file);
    const originalCode = readFileSync(filePath, "utf8");
    const client = new MorphClient({ trace });
    const warpGrep =
      options.only === "all" || options.only === "warpgrep"
        ? await client.warpGrep({
            repoRoot: options.repoRoot,
            searchTerm: options.search,
          })
        : undefined;
    const fastApply =
      options.only === "all" || options.only === "fast-apply"
        ? await client.fastApply({
            originalCode,
            codeEdit: options.codeEdit,
            instructions: options.instructions,
          })
        : undefined;
    const compact =
      options.only === "all" || options.only === "compact"
        ? await client.compact({
            input: JSON.stringify(
              { search: options.search, contexts: warpGrep?.contexts ?? [] },
              null,
              2,
            ),
            query: options.query,
            preserveRecent: 3,
          })
        : undefined;
    const diffArtifact = fastApply
      ? artifacts.put({
          content: fastApply.udiff ?? "",
          mimeType: "text/vnd.git-diff",
          redactionStatus: "redacted-before-persist",
          producerSpanId: rootSpan.spanId,
        })
      : undefined;
    if (diffArtifact) rootSpan.update({ outputArtifactIds: [diffArtifact.sha256] });
    rootSpan.event("morph_spike_completed", {
      capability: options.only,
      ...(warpGrep ? { warpToolCalls: warpGrep.toolCalls } : {}),
      ...(fastApply ? { fastApplySuccess: fastApply.success } : {}),
      ...(compact
        ? { compactBeforeBytes: compact.beforeBytes, compactAfterBytes: compact.afterBytes }
        : {}),
    });
    rootSpan.end("ok");
    const result = redactSecrets({
      runId,
      traceId,
      repository: options.repoRoot,
      file: options.file,
      capability: options.only,
      ...(warpGrep ? { warpGrep } : {}),
      ...(fastApply
        ? {
            fastApply: {
              success: fastApply.success,
              originalSha256: fastApply.originalSha256,
              finalSha256: fastApply.finalSha256,
              changes: fastApply.changes,
              udiff: fastApply.udiff,
              metadata: fastApply.metadata,
            },
          }
        : {}),
      ...(compact ? { compact } : {}),
      ...(diffArtifact ? { diffArtifact } : {}),
      trace: trace.read(),
    });
    writeFileSync(join(outputRoot, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ runId, traceId, outputRoot }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rootSpan.event("morph_spike_error", { message });
    rootSpan.end("error", {
      category: "provider_failure",
      message: message.length >= 8 ? message : `Provider error: ${message}`,
    });
    writeFileSync(
      join(outputRoot, "error.json"),
      JSON.stringify({ runId, traceId, error: message }, null, 2),
    );
    throw error;
  } finally {
    traceStore.close();
  }
}

main().catch((error) => {
  console.error(`Morph spike failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
