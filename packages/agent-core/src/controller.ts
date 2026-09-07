export const ADAPTIVE_POLICY_VERSION = "adaptive-rules-v1";

export type RoutingDecision = {
  route: "search" | "edit" | "compaction";
  selected: string;
  policyVersion: string;
  reason: string;
  features: Record<string, boolean | number | string | null>;
};

export type SearchRoutingFeatures = {
  exactIdentifierExists: boolean;
  repositoryFileCount: number;
  cheapMatchCount: number;
  querySemantics: "identifier" | "phrase" | "path";
  crossFileEstimate: number;
  previousSearchFailure: boolean;
  remainingBudget: number | null;
  warpGrepAvailable: boolean;
};

export type EditRoutingFeatures = {
  fileBytes: number;
  changedLineEstimate: number;
  nonContiguousRegions: number;
  exactOldStringAvailable: boolean;
  previousApplyFailure: boolean;
  remainingBudget: number | null;
  fastApplyAvailable: boolean;
};

export type CompactionRoutingFeatures = {
  contextBytes: number;
  growthRate: number;
  toolOutputShare: number;
  duplicationRatio: number;
  relevanceScore: number;
  remainingComplexity: number | null;
  morphCompactAvailable: boolean;
};

export function decideSearch(features: SearchRoutingFeatures): RoutingDecision {
  const shouldUseWarp =
    features.warpGrepAvailable &&
    (features.previousSearchFailure ||
      features.cheapMatchCount === 0 ||
      features.crossFileEstimate > 1 ||
      features.repositoryFileCount > 250);
  const selected = shouldUseWarp ? "warpgrep" : "raw-search";
  const reason = shouldUseWarp
    ? searchSpecialistReason(features)
    : "A cheap exact local search is sufficient for a small, single-file lookup.";
  return decision("search", selected, reason, features);
}

export function decideEdit(features: EditRoutingFeatures): RoutingDecision {
  const selected =
    features.fastApplyAvailable && features.previousApplyFailure
      ? "fast-apply"
      : features.exactOldStringAvailable &&
          features.changedLineEstimate <= 3 &&
          features.nonContiguousRegions <= 1
        ? "deterministic-edit"
        : features.changedLineEstimate <= 20
          ? "unified-diff"
          : "full-file";
  const reason =
    selected === "fast-apply"
      ? "The previous application failed and Fast Apply is available for a controlled retry."
      : selected === "deterministic-edit"
        ? "The exact old text is present and the change is small and contiguous."
        : selected === "unified-diff"
          ? "The edit is moderate-sized, so a structured diff preserves application boundaries."
          : "The edit is large or lacks an exact anchor, so a full-file strategy is the fallback.";
  return decision("edit", selected, reason, features);
}

export function decideCompaction(features: CompactionRoutingFeatures): RoutingDecision {
  const overBudget = features.contextBytes > 2_000;
  const shouldUseMorph =
    features.morphCompactAvailable &&
    (features.duplicationRatio > 0.25 ||
      features.relevanceScore < 0.5 ||
      (overBudget && features.growthRate > 0.7 && features.toolOutputShare > 0.7));
  const selected = shouldUseMorph
    ? "morph-compact"
    : overBudget || features.growthRate > 0.45 || features.toolOutputShare > 0.65
      ? "threshold-truncation"
      : "no-compaction";
  const reason = shouldUseMorph
    ? "The context has high duplication or low relevance, and Morph Compact is explicitly available."
    : selected === "threshold-truncation"
      ? "Context growth or tool-output share crosses the local byte-budget trigger."
      : "Context remains below the transparent compaction trigger.";
  return decision("compaction", selected, reason, features);
}

function searchSpecialistReason(features: SearchRoutingFeatures): string {
  if (features.previousSearchFailure)
    return "A prior search failed, so the repository-aware route is enabled.";
  if (features.cheapMatchCount === 0)
    return "Cheap search found no match, so repository-aware retrieval is enabled.";
  if (features.crossFileEstimate > 1)
    return "The task likely spans multiple files, so repository-aware retrieval is enabled.";
  return "Repository size exceeds the local-search threshold, so repository-aware retrieval is enabled.";
}

function decision(
  route: RoutingDecision["route"],
  selected: string,
  reason: string,
  features: Record<string, boolean | number | string | null>,
): RoutingDecision {
  return {
    route,
    selected,
    policyVersion: ADAPTIVE_POLICY_VERSION,
    reason,
    features,
  };
}
