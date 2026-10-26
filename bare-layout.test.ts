import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { detectBareLayout, ensureWorktree } from "./index.ts";

function runGit(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function createBareRepo() {
  const root = mkdtempSync(join(tmpdir(), "bare-layout-test-"));
  const seed = join(root, "seed");
  const bareRoot = join(root, "repo.git");
  const masterPath = join(bareRoot, "master");

  runGit(["init", "-b", "master", seed]);
  runGit(["-C", seed, "config", "user.name", "Bare Layout Test"]);
  runGit(["-C", seed, "config", "user.email", "bare-layout@example.invalid"]);
  writeFileSync(join(seed, "README"), "test\n");
  runGit(["-C", seed, "add", "README"]);
  runGit(["-C", seed, "commit", "-m", "initial commit"]);
  runGit(["clone", "--bare", seed, bareRoot]);
  runGit(["-C", bareRoot, "worktree", "add", masterPath, "master"]);

  return {
    root,
    bareRoot,
    masterPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("detects normal branch-derived layout and reuses its worktree", async () => {
  const repo = createBareRepo();
  try {
    assert.equal(await detectBareLayout(repo.masterPath), repo.bareRoot);
    assert.equal(
      await ensureWorktree(repo.bareRoot, "master", { allowNew: false }),
      repo.masterPath,
    );
  } finally {
    repo.cleanup();
  }
});

test("accepts and reuses an in-root worktree whose directory differs from its branch", async () => {
  const repo = createBareRepo();
  try {
    const branch = "feature/390410-price-indicies-sort";
    const recordedPath = join(
      repo.bareRoot,
      "feature/390410-price-indices-sort",
    );
    mkdirSync(dirname(recordedPath), { recursive: true });
    runGit([
      "-C",
      repo.bareRoot,
      "worktree",
      "add",
      "-b",
      branch,
      recordedPath,
      "master",
    ]);

    assert.equal(await detectBareLayout(repo.masterPath), repo.bareRoot);
    assert.equal(
      await ensureWorktree(repo.bareRoot, branch, { allowNew: false }),
      recordedPath,
    );
    assert.equal(
      runGit(["-C", repo.bareRoot, "worktree", "list", "--porcelain"])
        .split("\n")
        .includes(`worktree ${recordedPath}`),
      true,
    );
  } finally {
    repo.cleanup();
  }
});

test("rejects a linked worktree outside the bare root", async () => {
  const repo = createBareRepo();
  try {
    // Share the bare root's string prefix while remaining a sibling path.
    const externalPath = join(repo.root, "repo.git-external-worktree");
    runGit([
      "-C",
      repo.bareRoot,
      "worktree",
      "add",
      "-b",
      "feature/external",
      externalPath,
      "master",
    ]);
    assert.equal(await detectBareLayout(repo.masterPath), null);
  } finally {
    repo.cleanup();
  }
});

test("rejects a linked worktree without an associated branch", async () => {
  const repo = createBareRepo();
  try {
    const detachedPath = join(repo.bareRoot, "detached");
    runGit([
      "-C",
      repo.bareRoot,
      "worktree",
      "add",
      "--detach",
      detachedPath,
      "HEAD",
    ]);
    assert.equal(await detectBareLayout(repo.masterPath), null);
  } finally {
    repo.cleanup();
  }
});
