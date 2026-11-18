import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSemanticRelevance, setSemanticRelevanceDecision, semanticRelevanceVersion, semanticJobSelectionState, semanticShortlistVersion, mergeSemanticShortlist, expandSemanticShortlist } from "../src/semanticRelevance.js";

const relevant = { query: "средство от моли", wbCount: 100, relevance: "relevant" };
const disputed = { query: "от моли лаванда", ozonCount: 50, relevance: "disputed" };
const irrelevant = { query: "секции от моли", wbCount: 70, relevance: "irrelevant" };
const core = { relevanceVersion: semanticRelevanceVersion, allKeywords: [relevant, disputed, irrelevant] };

test("only confirmed relevant queries enter by default, without the former 36-query cap", () => {
  const large = { ...core, allKeywords: Array.from({ length: 80 }, (_, index) => ({ ...relevant, query: relevant.query + index })) };
  assert.equal(reconcileSemanticRelevance(large).selected.length, 80);
  assert.deepEqual(reconcileSemanticRelevance(core).selected, [relevant]);
});

test("manual exclusions survive another collection and reload", () => {
  const edited = setSemanticRelevanceDecision(core, relevant, "excluded");
  const after = reconcileSemanticRelevance(core, [], [edited]);
  assert.equal(after.selected.length, 0);
  assert.equal(after.core.allKeywords[0].manualDecision, "excluded");
});

test("disputed needs explicit inclusion; irrelevant never enters", () => {
  const edited = setSemanticRelevanceDecision(setSemanticRelevanceDecision(core, disputed, "included"), irrelevant, "included");
  assert.deepEqual(reconcileSemanticRelevance(core, [], [edited]).selected.map((row) => row.query), [relevant.query, disputed.query]);
});

test("current keys, removal proposals and unverified frequency do not become new additions", () => {
  assert.equal(reconcileSemanticRelevance(core, [], [], new Set([relevant.query])).selected.length, 0);
  assert.equal(reconcileSemanticRelevance(core, [], [], new Set(), [relevant]).selected.length, 0);
  assert.equal(reconcileSemanticRelevance({ ...core, allKeywords: [{ ...relevant, wbCount: 0 }] }).selected.length, 0);
});

test("a new rejection removes a previous unconfirmed selection while keeping another collection", () => {
  const other = { query: "другой подбор", wbCount: 20 };
  assert.deepEqual(reconcileSemanticRelevance(core, [other, disputed, irrelevant]).selected, [other, relevant]);
});

test("Ozon requires Ozon frequency and retains manual decisions across different seeds", () => {
  const ozon = { ...core, marketplace: "Ozon", allKeywords: [{ ...relevant, ozonCount: 40 }, disputed, irrelevant] };
  assert.equal(reconcileSemanticRelevance({ ...core, marketplace: "Ozon" }).selected.length, 0);
  const excluded = setSemanticRelevanceDecision(ozon, relevant, "excluded");
  const anotherSeed = reconcileSemanticRelevance({ ...ozon, allKeywords: [disputed] }, [], [excluded]);
  const returned = reconcileSemanticRelevance(ozon, [], [anotherSeed.core]);
  assert.equal(returned.selected.length, 0);
  const included = setSemanticRelevanceDecision(returned.core, disputed, "included");
  assert.deepEqual(reconcileSemanticRelevance(included, [], [included]).selected.map(row => row.query), [disputed.query]);
});

test("background input retains choices without sending entire query histories and evidence again", () => {
  const selected = { ...relevant, relevanceEvidence: [{ quote: 'x'.repeat(1000) }], manualDecision: 'excluded' };
  const previous = { semanticCore: { allKeywords: [{ ...disputed, manualDecision: 'included' }, ...Array(5000).fill(irrelevant)] } };
  const state = semanticJobSelectionState({ ...core, allKeywords: [selected] }, [relevant], [], [previous]);
  assert.equal(state.selected[0].wbCount, 100);
  assert.equal(state.selected[0].query, relevant.query);
  assert.equal(state.decisions.length, 2);
  assert.ok(!JSON.stringify(state).includes('relevanceEvidence'));
  assert.ok(JSON.stringify(state).length < 1000);
});

function shortlist() {
  return { ...core, marketplace: "Ozon", seedQuery: "пена", shortlist: { version: semanticShortlistVersion, limit: 30 },
    allKeywords: Array.from({ length: 65 }, (_, i) => ({ query: `пена для окон ${i} мл`, ozonCount: 100+i,
      relevance: "relevant", selectionStatus: "candidate", selectionGroup: `group${i}`, selectionRank: i+1 })) };
}

test("shortlist starts at 30 and expanding actually adds 10; reload keeps expansion and exclusions", () => {
  const prepared = shortlist();
  const first = reconcileSemanticRelevance(prepared);
  assert.equal(first.selected.length, 30);
  const expanded = reconcileSemanticRelevance({ ...first.core, shortlist: { ...prepared.shortlist, limit: 40 } }, first.selected);
  assert.equal(expanded.selected.length, 40);
  const edited = setSemanticRelevanceDecision(expanded.core, expanded.selected[0], "excluded");
  const after = reconcileSemanticRelevance(JSON.parse(JSON.stringify(edited)), expanded.selected, [edited]);
  assert.equal(after.selected.length, 39);
  assert.equal(after.core.shortlist.limit, 40);
  assert.equal(after.selected.some(row => row.query === expanded.selected[0].query), false);
});

test("duplicate and spelling rows remain visible source data and need explicit inclusion", () => {
  const prepared = shortlist();
  prepared.allKeywords[0].selectionStatus = "duplicate";
  prepared.allKeywords[1].selectionStatus = "review";
  prepared.allKeywords[2].ozonCount = 0;
  prepared.allKeywords[2].wbCount = 99999;
  const first = reconcileSemanticRelevance(prepared);
  assert.equal(first.selected.length, 30);
  assert.deepEqual(first.selected.slice(0,3).map(row => row.selectionRank), [4,5,6]);
  const edited = setSemanticRelevanceDecision(first.core, prepared.allKeywords[1], "included");
  const manual = reconcileSemanticRelevance(edited, first.selected, [edited]);
  assert.equal(manual.selected.length, 31);
  assert.equal(manual.selected.some(row => row.selectionStatus === "review"), true);
  assert.equal(manual.core.allKeywords.length, 65);
});

test("current queries occupy the entire equivalent group and manual exclusions do not refill", () => {
  const prepared = shortlist();
  prepared.allKeywords.push({ ...prepared.allKeywords[0], query: "оконная пена", selectionStatus: "duplicate" });
  const first = reconcileSemanticRelevance(prepared, [], [], new Set(["оконная пена"]));
  assert.equal(first.selected.length, 30);
  assert.equal(first.selected.some(row => row.selectionGroup === "group0"), false);
  const edited = setSemanticRelevanceDecision(first.core, first.selected[0], "excluded");
  assert.equal(reconcileSemanticRelevance(edited, first.selected, [edited], new Set(["оконная пена"])).selected.length, 29);
});

test("choosing another grammatical variant replaces its group instead of duplicating the meaning", () => {
  const prepared = shortlist();
  const variant = { ...prepared.allKeywords[0], query: "пена оконная", selectionStatus: "duplicate" };
  prepared.allKeywords.push(variant);
  const first = reconcileSemanticRelevance(prepared);
  const edited = setSemanticRelevanceDecision(first.core, variant, "included");
  const switched = reconcileSemanticRelevance(edited, first.selected, [edited]);
  assert.equal(switched.selected.length, 30);
  assert.deepEqual(switched.selected.filter(row => row.selectionGroup === "group0").map(row => row.query), [variant.query]);
  const excluded = setSemanticRelevanceDecision(switched.core, variant, "excluded");
  assert.equal(reconcileSemanticRelevance(excluded, switched.selected, [excluded]).selected.length, 29);
});

test("expansion skips excluded reserve rows instead of getting stuck on an empty next page", () => {
  const prepared = shortlist();
  prepared.allKeywords.slice(30,40).forEach(row => { row.manualDecision = "excluded"; });
  const first = reconcileSemanticRelevance(prepared);
  const expanded = expandSemanticShortlist(first.core, first.selected);
  assert.equal(expanded.selected.length, 40);
  assert.equal(expanded.core.shortlist.limit, 50);
  assert.equal(expanded.selected.some(row => row.manualDecision === "excluded"), false);
});

test("preparing an old selection merges metadata only, preserving specialist choices and evidence", () => {
  const prepared = shortlist();
  const original = { ...prepared, shortlist: undefined, allKeywords: prepared.allKeywords.map(row => ({
    query: row.query, ozonCount: row.ozonCount, relevance: row.relevance, manualDecision: row.selectionRank === 1 ? "excluded" : undefined,
    relevanceReason: "Ручное обоснование", relevanceEvidence: [{ factId: "title", quote: "пена" }],
  })) };
  const merged = mergeSemanticShortlist(original, prepared);
  assert.equal(merged.allKeywords[0].manualDecision, "excluded");
  assert.equal(merged.allKeywords[0].relevanceReason, "Ручное обоснование");
  assert.equal(reconcileSemanticRelevance(merged, original.allKeywords, [original]).selected.length, 29);
  assert.equal(original.shortlist, undefined);
  assert.throws(() => mergeSemanticShortlist(original, { ...prepared, allKeywords: prepared.allKeywords.slice(1) }), /изменилась/);
  assert.throws(() => mergeSemanticShortlist(original, { ...prepared, allKeywords: prepared.allKeywords.map((row,i) => i === 0 ? { ...row, relevance: "disputed" } : row) }), /изменилась/);
  const state = semanticJobSelectionState(merged);
  assert.equal(state.shortlist.version, semanticShortlistVersion);
  assert.equal(state.seedQuery, "пена");
});
