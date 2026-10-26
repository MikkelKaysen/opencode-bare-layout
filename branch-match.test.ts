import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, matchBranch, maxTypoDistance } from "./branch-match.ts";

const branches = [
  "master",
  "feature/321321-somethin-some-other",
  "feature/385225-cancel-ebdn",
  "hotfix/fix-login",
];

test("editDistance counts adjacent transposition as one edit", () => {
  assert.equal(editDistance("321312", "321321"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});

test("exact local branch name wins", () => {
  assert.deepEqual(matchBranch("master", branches), { kind: "match", branch: "master" });
});

test("unique case-insensitive substring matches", () => {
  assert.deepEqual(matchBranch("CANCEL", branches), {
    kind: "match",
    branch: "feature/385225-cancel-ebdn",
  });
});

test("ambiguous substring is reported, not chosen", () => {
  const r = matchBranch("feature", branches);
  assert.equal(r?.kind, "ambiguous");
});

test("transposed digits select the branch (321312 -> 321321)", () => {
  assert.deepEqual(matchBranch("321312", branches), {
    kind: "match",
    branch: "feature/321321-somethin-some-other",
  });
});

test("fuzzy tie between equally-close candidates is ambiguous", () => {
  const r = matchBranch("385226", ["feature/385225-a", "fix/385227-b"]);
  assert.equal(r?.kind, "ambiguous");
  assert.deepEqual(r?.kind === "ambiguous" && r.candidates.sort(), [
    "feature/385225-a",
    "fix/385227-b",
  ]);
});

test("short queries get no typo tolerance", () => {
  assert.equal(maxTypoDistance("1234"), 0);
  assert.equal(matchBranch("1234", ["feature/1235-x"]), null);
});

test("poor matches are rejected (no match -> null)", () => {
  assert.equal(matchBranch("999999", branches), null);
  assert.equal(matchBranch("nonexistent", branches), null);
});
