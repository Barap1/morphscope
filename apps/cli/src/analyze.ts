import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { analyzeRuns } from "@morphscope/evaluator/analysis";
import { RunSchema, type Run } from "@morphscope/schemas";

const MAX_RUN_BYTES = 8 * 1024 * 1024;

export async function runAnalysis(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const files = findRunFiles(options.input);
  const runs: Run[] = [];
  for (const file of files) {
    const payload = readPayload(file);
    const parsed = RunSchema.safeParse(payload?.run);
    if (parsed.success) runs.push(parsed.data);
  }
  const filtered = options.experiment
    ? runs.filter((run) => run.experimentId === options.experiment)
    : runs;
  const report = analyzeRuns(filtered);
  const output = resolve(options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        input: options.input,
        runFiles: files.length,
        parsedRuns: filtered.length,
        output,
        configurations: report.source.configurationCount,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): { input: string; output: string; experiment?: string } {
  if (argv[0] !== "analysis") {
    throw new Error(
      "usage: pnpm morphscope analysis [--input .morphscope] [--output analysis/output/results.json] [--experiment <id>]",
    );
  }
  let input = resolve(process.cwd(), ".morphscope");
  let output = resolve(process.cwd(), "analysis/output/results.json");
  let experiment: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--input") input = resolve(argv[++index] ?? "");
    else if (argv[index] === "--output") output = resolve(argv[++index] ?? "");
    else if (argv[index] === "--experiment") experiment = argv[++index];
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  return { input, output, experiment };
}

function findRunFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  walk(root, 0, files);
  return files.sort();
}

function walk(directory: string, depth: number, files: string[]): void {
  if (depth > 8) return;
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "workspace" || entry.name === "node_modules" || entry.name === ".git")
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, depth + 1, files);
    else if (entry.isFile() && entry.name === "run.json") files.push(path);
  }
}

function readPayload(file: string): Record<string, unknown> | null {
  try {
    if (!statSync(file).isFile() || statSync(file).size > MAX_RUN_BYTES) return null;
    const payload: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
