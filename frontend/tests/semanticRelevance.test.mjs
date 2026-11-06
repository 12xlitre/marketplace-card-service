import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSemanticRelevance, setSemanticRelevanceDecision, semanticRelevanceVersion } from "../src/semanticRelevance.js";

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
