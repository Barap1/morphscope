import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { ProviderCallMetadata } from "./provider-types.js";

export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

export type SearchContext = {
  file: string;
  content: string;
};

export type SearchMeasurement = {
  numberSearches: number;
  totalSearchLatencyMs: number;
  bytesContextReturned: number;
  fileRecallProxy: number | null;
  timeToFirstReferenceRelevantFileMs: number | null;
  uniqueFilesFound: string[];
  downstreamSuccess: boolean | null;
};

export type SearchProviderInput = {
  query: string;
  path?: string;
  maxResults?: number;
  referenceRelevantFiles?: string[];
};

export type SearchProviderResult = {
  provider: string;
  rendered: string;
  contexts: SearchContext[];
  matches: SearchMatch[];
  measurement: SearchMeasurement;
  metadata?: ProviderCallMetadata;
};

export interface SearchProvider {
  readonly id: string;
  search(input: SearchProviderInput): Promise<SearchProviderResult>;
}

export type RawSearchExecutor = (input: { query: string; path?: string }) => {
  matches: SearchMatch[];
};

/** The conventional local search strategy used as the controlled baseline. */
export class RawSearchProvider implements SearchProvider {
  readonly id = "raw-search";

  constructor(private readonly execute: RawSearchExecutor) {}

  async search(input: SearchProviderInput): Promise<SearchProviderResult> {
    const startedAt = performance.now();
    const raw = this.execute({ query: input.query, path: input.path });
    const matches = input.maxResults ? raw.matches.slice(0, input.maxResults) : [...raw.matches];
    const rendered = matches
      .map((match) => `${match.path}:${match.line}:${match.column}:${match.text}`)
      .join("\n");
    const latencyMs = performance.now() - startedAt;
    return makeResult({
      provider: this.id,
      rendered,
      contexts: matches.map((match) => ({ file: match.path, content: match.text })),
      matches,
      latencyMs,
      referenceRelevantFiles: input.referenceRelevantFiles,
    });
  }
}

export type WarpGrepExecutor = (input: {
  searchTerm: string;
  repoRoot: string;
  maxTurns?: number;
}) => Promise<{
  contexts: SearchContext[];
  toolCalls: number;
  metadata: ProviderCallMetadata;
}>;

/** Morph's repository-aware search strategy behind the same SearchProvider contract. */
export class WarpGrepProvider implements SearchProvider {
  readonly id = "warpgrep";

  constructor(
    private readonly execute: WarpGrepExecutor,
    private readonly repoRoot: string,
  ) {}

  async search(input: SearchProviderInput): Promise<SearchProviderResult> {
    const startedAt = performance.now();
    const result = await this.execute({
      searchTerm: input.query,
      repoRoot: this.repoRoot,
    });
    const latencyMs = result.metadata.latencyMs ?? performance.now() - startedAt;
    const validatedContexts = result.contexts.flatMap((context) => {
      const file = normalizeRepositoryPath(this.repoRoot, context.file);
      return file ? [{ ...context, file }] : [];
    });
    const contexts = input.maxResults
      ? validatedContexts.slice(0, input.maxResults)
      : validatedContexts;
    const rendered = contexts.map((context) => `${context.file}\n${context.content}`).join("\n");
    return makeResult({
      provider: this.id,
      rendered,
      contexts,
      matches: contexts.map((context) => ({
        path: context.file,
        line: 1,
        column: 1,
        text: context.content,
      })),
      latencyMs,
      referenceRelevantFiles: input.referenceRelevantFiles,
      metadata: result.metadata,
    });
  }
}

function normalizeRepositoryPath(root: string, input: string | undefined): string | null {
  if (!input || input.includes("\0")) return null;
  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) return null;

  try {
    const realPath = realpathSync.native(candidate);
    const realRelativePath = relative(root, realPath);
    if (realRelativePath === ".." || realRelativePath.startsWith(`..${sep}`)) return null;
    return realRelativePath || ".";
  } catch {
    return relativePath || ".";
  }
}

function makeResult(input: {
  provider: string;
  rendered: string;
  contexts: SearchContext[];
  matches: SearchMatch[];
  latencyMs: number;
  referenceRelevantFiles?: string[];
  metadata?: ProviderCallMetadata;
}): SearchProviderResult {
  const uniqueFilesFound = [...new Set(input.contexts.map((context) => context.file))].sort();
  const referenceFiles = new Set(input.referenceRelevantFiles ?? []);
  const relevantFiles = uniqueFilesFound.filter((file) => referenceFiles.has(file));
  return {
    provider: input.provider,
    rendered: input.rendered,
    contexts: input.contexts,
    matches: input.matches,
    measurement: {
      numberSearches: 1,
      totalSearchLatencyMs: input.latencyMs,
      bytesContextReturned: Buffer.byteLength(input.rendered, "utf8"),
      fileRecallProxy: referenceFiles.size > 0 ? relevantFiles.length / referenceFiles.size : null,
      timeToFirstReferenceRelevantFileMs: relevantFiles.length > 0 ? input.latencyMs : null,
      uniqueFilesFound,
      downstreamSuccess: null,
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
