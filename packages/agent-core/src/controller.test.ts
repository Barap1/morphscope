import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_POLICY_VERSION,
  decideCompaction,
  decideEdit,
  decideSearch,
} from "./controller.js";

describe("adaptive rules", () => {
  it("keeps a small exact lookup on local search and records the policy", () => {
    const decision = decideSearch({
      exactIdentifierExists: true,
      repositoryFileCount: 12,
      cheapMatchCount: 1,
      querySemantics: "identifier",
      crossFileEstimate: 1,
      previousSearchFailure: false,
      remainingBudget: 6,
      warpGrepAvailable: true,
    });
    expect(decision.selected).toBe("raw-search");
    expect(decision.policyVersion).toBe(ADAPTIVE_POLICY_VERSION);
    expect(decision.reason).toContain("cheap exact local search");
  });

  it("selects specialist routes when the evidence warrants them", () => {
    expect(
      decideSearch({
        exactIdentifierExists: false,
        repositoryFileCount: 500,
        cheapMatchCount: 0,
        querySemantics: "phrase",
        crossFileEstimate: 3,
        previousSearchFailure: false,
        remainingBudget: 2,
        warpGrepAvailable: true,
      }).selected,
    ).toBe("warpgrep");
    expect(
      decideEdit({
        fileBytes: 500,
        changedLineEstimate: 2,
        nonContiguousRegions: 0,
        exactOldStringAvailable: true,
        previousApplyFailure: false,
        remainingBudget: 3,
        fastApplyAvailable: true,
      }).selected,
    ).toBe("deterministic-edit");
    expect(
      decideCompaction({
        contextBytes: 8_000,
        growthRate: 0.9,
        toolOutputShare: 0.8,
        duplicationRatio: 0.4,
        relevanceScore: 0.4,
        remainingComplexity: 2,
        morphCompactAvailable: true,
      }).selected,
    ).toBe("morph-compact");
  });

  it("uses local transparent compaction when Morph is unavailable", () => {
    const decision = decideCompaction({
      contextBytes: 3_000,
      growthRate: 0.8,
      toolOutputShare: 0.7,
      duplicationRatio: 0.4,
      relevanceScore: 0.4,
      remainingComplexity: 2,
      morphCompactAvailable: false,
    });
    expect(decision.selected).toBe("threshold-truncation");
    expect(decision.reason).toContain("byte-budget trigger");
  });
});
