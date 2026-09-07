import type { BaselinePlan, BaselineToolbox } from "@morphscope/agent-core";
import type { LocalWorkspace } from "@morphscope/sandbox";

export type SearchOverride = (
  query: string,
  options?: { path?: string; maxResults?: number },
) => string;

export type ReplaceOverride = (input: {
  path: string;
  search: string;
  replacement: string;
  expectedOccurrences?: number;
}) => { path: string; replacements: number };

export function changedFilesFromPlan(plan: BaselinePlan): string[] {
  return [
    ...new Set(
      plan.actions.flatMap((action) => {
        if (action.type === "replace") return [action.path];
        if (action.type !== "apply_patch") return [];
        return [...action.patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
      }),
    ),
  ];
}

export function createToolbox(
  workspace: LocalWorkspace,
  searchOverride?: SearchOverride,
  replaceOverride?: ReplaceOverride,
): BaselineToolbox {
  return {
    listFiles: (path?: string) => workspace.listFiles(path),
    search: (query: string, options?: { path?: string; maxResults?: number }) => {
      if (searchOverride) return searchOverride(query, options);
      const result = workspace.search(query, options?.path);
      const matches = options?.maxResults
        ? result.matches.slice(0, options.maxResults)
        : result.matches;
      return matches
        .map((match) => `${match.path}:${match.line}:${match.column}:${match.text}`)
        .join("\n");
    },
    readFile: (path: string, options?: { startLine?: number; endLine?: number }) => {
      const lines = workspace.readFile(path).split(/\r?\n/);
      const start = Math.max(1, options?.startLine ?? 1);
      const end = Math.min(lines.length, options?.endLine ?? lines.length);
      return lines.slice(start - 1, end).join("\n");
    },
    replaceFile: (input: { path: string; search: string; replacement: string }) =>
      replaceOverride
        ? replaceOverride(input)
        : workspace.replaceFile(input.path, input.search, input.replacement),
    applyPatch: (patch: string) => workspace.applyPatch(patch),
    runCommand: (command: string) => workspace.runSetup(command),
    gitDiff: () => workspace.collectDiff().diff,
  };
}
