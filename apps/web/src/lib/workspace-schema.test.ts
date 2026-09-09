import { describe, expect, it } from "vitest";
import { parseWorkspaceRecordInput } from "./workspace-schema";

describe("workspace record schemas", () => {
  it("accepts bounded CRUD inputs for each record kind", () => {
    expect(
      parseWorkspaceRecordInput({
        kind: "task",
        payload: {
          id: "task-example",
          repository: "Barap1/morphscope",
          commit: "main",
          issue: "Clarify the workspace contract for the next recorded evaluation.",
          setup: "pnpm install",
          evaluation: "pnpm test",
          tags: ["release"],
        },
      }).kind,
    ).toBe("task");
    expect(
      parseWorkspaceRecordInput({
        kind: "experiment",
        payload: {
          id: "experiment-example",
          name: "Search study",
          description: "Compare retrieval configurations on a fixed repository task.",
          taskId: null,
          sourceCommit: null,
          variedVariable: "searchProvider",
          status: "draft",
        },
      }).kind,
    ).toBe("experiment");
    expect(
      parseWorkspaceRecordInput({
        kind: "run",
        payload: {
          id: "run-example",
          experimentId: "experiment-example",
          taskId: "task-example",
          configurationId: "baseline",
          provider: "deterministic",
          model: "fixture",
          status: "planned",
          notes: "",
        },
      }).kind,
    ).toBe("run");
  });

  it("rejects unsupported fields and malformed identifiers", () => {
    expect(() =>
      parseWorkspaceRecordInput({
        kind: "task",
        payload: {
          id: "../outside",
          repository: "repo",
          commit: "main",
          issue: "A valid issue description.",
          setup: "setup",
          evaluation: "test",
          tags: [],
          secret: "should not be accepted",
        },
      }),
    ).toThrow();
  });
});
