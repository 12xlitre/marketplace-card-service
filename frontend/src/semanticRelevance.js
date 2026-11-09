export const semanticRelevanceVersion = "card-relevance-v1";

export function relevanceQueryKey(value) {
  return String(typeof value === "string" ? value : value?.query || "").toLowerCase().replace(/ё/g, "е").trim();
}

export function hasSemanticRelevance(core) {
  return core?.relevanceVersion === semanticRelevanceVersion;
}

export function hasSemanticDemand(row, core) {
  return Number(row.ozonCount) > 0 || (core?.marketplace !== "Ozon" && Number(row.wbCount) > 0);
}

export function reconcileSemanticRelevance(core, selected = [], previousCores = [], existingKeys = new Set(), removal = []) {
  if (!hasSemanticRelevance(core)) return { core, selected };
  const decisions = new Map(previousCores.flatMap((previous) => [...(previous?.decisions || []), ...(previous?.allKeywords || [])])
    .filter((row) => ["included", "excluded"].includes(row.manualDecision))
    .map((row) => [relevanceQueryKey(row), row.manualDecision]));
  const rows = (core.allKeywords || []).map((row) => ({
    ...row,
    ...(decisions.has(relevanceQueryKey(row)) ? { manualDecision: decisions.get(relevanceQueryKey(row)) } : {}),
  }));
  const queryKeys = new Set(rows.map(relevanceQueryKey));
  const removedKeys = new Set(removal.map(relevanceQueryKey));
  const keep = selected.filter((row) => !queryKeys.has(relevanceQueryKey(row)));
  const eligible = rows.filter((row) => {
    const key = relevanceQueryKey(row);
    return !existingKeys.has(key) && !removedKeys.has(key)
      && hasSemanticDemand(row, core)
      && row.manualDecision !== "excluded"
      && (row.relevance === "relevant" || (row.relevance === "disputed" && row.manualDecision === "included"));
  });
  return { core: { ...core, allKeywords: rows,
    decisions: [...decisions].map(([query, manualDecision]) => ({ query, manualDecision })),
  }, selected: [...keep, ...eligible] };
}

export function setSemanticRelevanceDecision(core, row, decision) {
  const key = relevanceQueryKey(row);
  return {
    ...core,
    allKeywords: (core?.allKeywords || []).map((item) => relevanceQueryKey(item) === key ? { ...item, manualDecision: decision } : item),
  };
}
