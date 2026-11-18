export const semanticRelevanceVersion = "card-relevance-v1";
export const semanticShortlistVersion = "meaning-shortlist-v1";
export const hasSemanticShortlist = core => core?.shortlist?.version === semanticShortlistVersion;

export function semanticShortlistPool(core, existingKeys = new Set(), removal = []) {
  const rows = core?.allKeywords || [];
  const removed = new Set(removal.map(relevanceQueryKey));
  const occupied = new Set(rows.filter(row => existingKeys.has(relevanceQueryKey(row)))
    .map(row => row.selectionGroup).filter(Boolean));
  return rows.filter(row => row.relevance === "relevant" && row.selectionStatus === "candidate"
    && !occupied.has(row.selectionGroup) && !existingKeys.has(relevanceQueryKey(row)) && !removed.has(relevanceQueryKey(row))
    && Number(core.marketplace === "Ozon" ? row.ozonCount : row.wbCount) > 0)
    .sort((a, b) => Number(a.selectionRank || 5001) - Number(b.selectionRank || 5001));
}

export function relevanceQueryKey(value) {
  return String(typeof value === "string" ? value : value?.query || "").toLowerCase().replace(/ё/g, "е").trim();
}

export function hasSemanticRelevance(core) {
  return core?.relevanceVersion === semanticRelevanceVersion;
}

export function hasSemanticDemand(row, core) {
  if (hasSemanticShortlist(core)) return Number(core.marketplace === "Ozon" ? row.ozonCount : row.wbCount) > 0;
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
  const keep = selected.filter((row) => !queryKeys.has(relevanceQueryKey(row)) && !removedKeys.has(relevanceQueryKey(row)));
  const annotated = { ...core, allKeywords: rows };
  const shortlistKeys = hasSemanticShortlist(core) ? new Set(semanticShortlistPool(annotated, existingKeys, removal)
    .slice(0, Math.max(30, Math.min(5000, Number(core.shortlist.limit) || 30))).map(relevanceQueryKey)) : null;
  const manualGroups = new Set(rows.filter(row => row.manualDecision === "included").map(row => row.selectionGroup).filter(Boolean));
  const eligible = rows.filter((row) => {
    const key = relevanceQueryKey(row);
    return !existingKeys.has(key) && !removedKeys.has(key)
      && hasSemanticDemand(row, core)
      && row.manualDecision !== "excluded"
      && (row.relevance === "relevant" || (row.relevance === "disputed" && row.manualDecision === "included"))
      && (!shortlistKeys || (shortlistKeys.has(key) && !manualGroups.has(row.selectionGroup)) || row.manualDecision === "included");
  });
  return { core: { ...core, allKeywords: rows,
    decisions: [...decisions].map(([query, manualDecision]) => ({ query, manualDecision })),
  }, selected: shortlistKeys ? [...keep, ...eligible].sort((a,b) => Number(a.selectionRank || 5001) - Number(b.selectionRank || 5001)) : [...keep, ...eligible] };
}

export function mergeSemanticShortlist(core, prepared) {
  const source = new Map((prepared?.allKeywords || []).map(row => [relevanceQueryKey(row), row]));
  if (!hasSemanticShortlist(prepared) || source.size !== (core?.allKeywords || []).length
    || (core.allKeywords || []).some(row => source.get(relevanceQueryKey(row))?.relevance !== row.relevance)) {
    throw new Error("Подборка изменилась. Откройте её заново перед отбором.");
  }
  const fields = ["selectionGroup", "selectionStatus", "selectionReason", "selectionRepresentative", "selectionRank"];
  return { ...core, shortlist: { ...prepared.shortlist, limit: 30 }, allKeywords: core.allKeywords.map(row => {
    const annotated = { ...row };
    fields.forEach(field => { delete annotated[field]; if (source.get(relevanceQueryKey(row))[field] !== undefined) annotated[field] = source.get(relevanceQueryKey(row))[field]; });
    return annotated;
  }) };
}

export function expandSemanticShortlist(core, selected = [], existingKeys = new Set(), removal = []) {
  if (!hasSemanticShortlist(core)) return null;
  const pool = semanticShortlistPool(core, existingKeys, removal);
  const keys = new Set(selected.map(relevanceQueryKey));
  const remaining = pool.map((row, index) => ({ row, index })).filter(({row, index}) => index >= core.shortlist.limit
    && row.manualDecision !== "excluded" && !keys.has(relevanceQueryKey(row))).slice(0, 10);
  if (!remaining.length) return { core, selected };
  const expanded = { ...core, shortlist: { ...core.shortlist, limit: remaining.at(-1).index + 1 } };
  return reconcileSemanticRelevance(expanded, selected, [expanded], existingKeys, removal);
}

export function setSemanticRelevanceDecision(core, row, decision) {
  const key = relevanceQueryKey(row);
  return {
    ...core,
    allKeywords: (core?.allKeywords || []).map((item) => relevanceQueryKey(item) === key ? { ...item, manualDecision: decision }
      : hasSemanticShortlist(core) && decision === "included" && row.selectionGroup && item.selectionGroup === row.selectionGroup
        ? { ...item, manualDecision: "excluded" } : item),
  };
}

export function semanticJobSelectionState(core, selected = [], removal = [], reports = []) {
  const decisions = new Map([...reports].reverse().flatMap(report => [
    ...(report?.semanticCore?.decisions || []), ...(report?.semanticCore?.allKeywords || []),
  ]).concat(core?.decisions || [], core?.allKeywords || [])
    .filter(row => ['included', 'excluded'].includes(row.manualDecision))
    .map(row => [relevanceQueryKey(row), { query: row.query, manualDecision: row.manualDecision }]));
  const compact = rows => rows.map(row => Object.fromEntries(['query','wbCount','ozonCount','source','relevanceReason','removalReason']
    .filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  return { selected: compact(selected), removal: compact(removal), decisions: [...decisions.values()],
    ...(hasSemanticShortlist(core) ? { shortlist: core.shortlist, seedQuery: core.seedQuery } : {}) };
}
