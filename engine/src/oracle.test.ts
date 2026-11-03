import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Node, Tri } from "./index.ts";
import { defineRuleSet, evaluateRuleSet } from "./index.ts";

// Brute-force reference: enumerate every true/false assignment of the unknown
// leaves; a single common result is that result, otherwise "unknown".
// Written over a tree with explicit boolean semantics, independent of evaluate.ts.
type Tree =
  | { leaf: number }
  | { all: Tree[] }
  | { any: Tree[] }
  | { not: Tree }
  | { atLeast: number; of: Tree[] };

const boolEval = (t: Tree, a: boolean[]): boolean => {
  if ("leaf" in t) return a[t.leaf] as boolean;
  if ("all" in t) return t.all.every((c) => boolEval(c, a));
  if ("any" in t) return t.any.some((c) => boolEval(c, a));
  if ("not" in t) return !boolEval(t.not, a);
  return t.of.filter((c) => boolEval(c, a)).length >= t.atLeast;
};

const oracle = (t: Tree, vals: Tri[]): Tri => {
  const unknownAt = vals.flatMap((v, i) => (v === "unknown" ? [i] : []));
  const seen = new Set<boolean>();
  for (let mask = 0; mask < 1 << unknownAt.length; mask++) {
    const a = vals.map((v) => v === true);
    unknownAt.forEach((pos, bit) => {
      a[pos] = Boolean(mask & (1 << bit));
    });
    seen.add(boolEval(t, a));
  }
  return seen.size === 1 ? ([...seen][0] as boolean) : "unknown";
};

const toNode = (t: Tree): Node => {
  if ("leaf" in t) return `c${t.leaf}`;
  if ("all" in t) return { all: t.all.map(toNode) };
  if ("any" in t) return { any: t.any.map(toNode) };
  if ("not" in t) return { not: toNode(t.not) };
  return { atLeast: { n: t.atLeast, of: t.of.map(toNode) } };
};

const conditionsFor = (k: number) =>
  Array.from({ length: k }, (_, i) => ({
    id: `c${i}`,
    label: `label ${i}`,
    variable: `v${i}`,
    op: ">=" as const,
    value: 1,
    unit: "u",
  }));

// All 3^k assignments; leaf values reach the evaluator as real numbers (1 / 0 / absent).
const assignments = (k: number): Tri[][] => {
  let acc: Tri[][] = [[]];
  for (let i = 0; i < k; i++)
    acc = acc.flatMap((p) =>
      ([true, false, "unknown"] as Tri[]).map((v) => [...p, v]),
    );
  return acc;
};
const toInput = (vals: Tri[]) => {
  const input: Record<string, number> = {};
  vals.forEach((v, i) => {
    if (v !== "unknown") input[`v${i}`] = v ? 1 : 0;
  });
  return input;
};

const leafUses = (t: Tree): number[] => {
  if ("leaf" in t) return [t.leaf];
  if ("not" in t) return leafUses(t.not);
  return (("all" in t ? t.all : "any" in t ? t.any : t.of) as Tree[]).flatMap(
    leafUses,
  );
};

// Kleene logic is exact when every leaf occurs once. With a repeated leaf
// (all[a, not a]) it may answer "unknown" where the oracle is definite; that
// is conservative. It must never answer a definite value the oracle disputes.
const check = (tree: Tree, k: number) => {
  const uses = leafUses(tree);
  const exact = new Set(uses).size === uses.length;
  const rs = defineRuleSet([
    { id: "r", conditions: conditionsFor(k), combine: toNode(tree) },
  ]);
  let n = 0;
  for (const vals of assignments(k)) {
    const got = evaluateRuleSet(rs, toInput(vals)).rules[0]?.result;
    const want = oracle(tree, vals);
    if (exact || got !== "unknown")
      assert.equal(got, want, JSON.stringify([tree, vals]));
    n++;
  }
  return n;
};

// Depth 0: leaves. Depth 1: combinators over leaves. Depth 2: combinators over depth<=1 trees.
const leaves = (k: number): Tree[] =>
  Array.from({ length: k }, (_, leaf) => ({ leaf }));
const combos = (children: Tree[], maxArity: number): Tree[] => {
  const out: Tree[] = children.map((not) => ({ not }));
  const lists: Tree[][] = [];
  for (const a of children)
    for (const b of children) {
      lists.push([a, b]);
      if (maxArity >= 3) for (const c of children) lists.push([a, b, c]);
    }
  for (const of of lists) {
    out.push({ all: of }, { any: of });
    for (let n = 1; n <= of.length; n++) out.push({ atLeast: n, of });
  }
  return out;
};

describe("evaluateRuleSet agrees with the brute-force oracle", () => {
  it("every tree over 3 leaves up to depth 2, all assignments", () => {
    const depth0 = leaves(3);
    const depth1 = combos(depth0, 3);
    // depth 2: binary combinators over leaves + depth1 (full ternary would be 10^6 trees).
    const depth2 = combos([...depth0, ...depth1], 2);
    let trees = 0;
    let evals = 0;
    for (const t of [...depth1, ...depth2]) {
      evals += check(t, 3);
      trees++;
    }
    assert.ok(trees > 1000);
    assert.equal(evals, trees * 27);
  });

  it("single-occurrence ternary roots over depth<=1 children, exact", () => {
    const children = [...leaves(3), ...combos(leaves(3), 3)];
    const seen: Tree[] = [];
    // [x, y, z] over children, keeping only lists that use each leaf at most once.
    for (const x of children)
      for (const y of children)
        for (const z of children) {
          const uses = [x, y, z].flatMap(leafUses);
          if (new Set(uses).size !== uses.length) continue;
          const of = [x, y, z];
          seen.push({ all: of }, { any: of });
          for (let n = 1; n <= 3; n++) seen.push({ atLeast: n, of });
        }
    assert.ok(seen.length >= 200);
    for (const t of seen) check(t, 3);
  });

  it("arity-1 lists at depth 1 and 2", () => {
    const wrap = (c: Tree): Tree[] => [
      { all: [c] },
      { any: [c] },
      { atLeast: 1, of: [c] },
      { not: c },
    ];
    const level1 = leaves(3).flatMap(wrap);
    const level2 = level1.flatMap(wrap);
    for (const t of [...level1, ...level2]) check(t, 3);
    assert.equal(level1.length + level2.length, 12 + 48);
  });

  it("atLeast with every n over 4 leaves, all 81 assignments", () => {
    for (let n = 1; n <= 4; n++) {
      const tree: Tree = { atLeast: n, of: leaves(4) };
      assert.equal(check(tree, 4), 81);
    }
  });

  it("invariant: if the best case reaches n, atLeast is never false", () => {
    for (let n = 1; n <= 4; n++) {
      const rs = defineRuleSet([
        {
          id: "r",
          conditions: conditionsFor(4),
          combine: toNode({ atLeast: n, of: leaves(4) }),
        },
      ]);
      for (const vals of assignments(4)) {
        const best = vals.filter((v) => v !== false).length;
        const got = evaluateRuleSet(rs, toInput(vals)).rules[0]?.result;
        if (best >= n) assert.notEqual(got, false, JSON.stringify([n, vals]));
      }
    }
  });
});
