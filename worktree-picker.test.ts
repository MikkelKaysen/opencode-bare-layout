import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorktrees, pickExistingWorktree } from "./worktree-picker.ts";

test("parses porcelain paths and branch names while retaining branchless records", () => {
  assert.deepEqual(
    parseWorktrees(
      [
        "worktree /repo.git",
        "bare",
        "",
        "worktree /repo.git/main",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repo.git/detached",
        "HEAD def456",
        "detached",
        "",
        "branch refs/heads/",
        "",
        "branch refs/heads/orphan",
        "",
      ].join("\n"),
    ),
    [
      { path: "/repo.git" },
      { path: "/repo.git/main", branch: "main" },
      { path: "/repo.git/detached" },
    ],
  );
});

test("offers searchable worktree choices and moves the route session to the selected path", async () => {
  const moved: Array<{ sessionID: string; directory: string }> = [];
  const messages: string[] = [];
  let offered: readonly { title: string; value: string; description: string }[] =
    [];

  await pickExistingWorktree({
    sessionID: "session-123",
    location: "/repo.git/current",
    list: async (location) => {
      assert.equal(location, "/repo.git/current");
      return [
        "worktree /repo.git",
        "",
        "worktree /repo.git/current",
        "branch refs/heads/current",
        "",
        "worktree /repo.git/feature-dir",
        "branch refs/heads/feature/linked",
        "",
        "worktree /repo.git/detached",
        "detached",
        "",
        "worktree /repo.git/missing-branch",
      ].join("\n");
    },
    select: async (choices) => {
      offered = choices;
      return choices[0]?.value;
    },
    move: async (sessionID, directory) => moved.push({ sessionID, directory }),
    toast: (message) => messages.push(message),
  });

  assert.deepEqual(offered, [
    {
      title: "feature/linked",
      value: "/repo.git/feature-dir",
      description: "/repo.git/feature-dir",
    },
  ]);
  assert.deepEqual(moved, [
    { sessionID: "session-123", directory: "/repo.git/feature-dir" },
  ]);
  assert.deepEqual(messages, []);
});

test("treats cancellation as a no-op and reports missing sessions and Git/API errors", async () => {
  const moved: string[] = [];
  const messages: string[] = [];
  const common = {
    location: "/repo.git/current",
    list: async () => "worktree /repo.git/current\nbranch refs/heads/current\n",
    select: async () => undefined,
    move: async (_sessionID: string, directory: string) => moved.push(directory),
    toast: (message: string) => messages.push(message),
  };

  await pickExistingWorktree({ ...common, sessionID: "session-123" });
  await pickExistingWorktree({ ...common, sessionID: undefined });
  await pickExistingWorktree({
    ...common,
    sessionID: "session-123",
    list: async () => {
      throw new Error("git unavailable");
    },
  });
  await pickExistingWorktree({
    ...common,
    sessionID: "session-123",
    list: async () => "worktree /repo.git/other\nbranch refs/heads/other\n",
    select: async (choices) => choices[0]?.value,
    move: async () => {
      throw new Error("session move failed");
    },
  });

  assert.deepEqual(moved, []);
  assert.equal(messages[0], "No other linked worktrees found. Use /worktree-existing <branch> to attach to a branch.");
  assert.match(messages[1] ?? "", /Open a session/);
  assert.match(messages[2] ?? "", /git unavailable/);
  assert.match(messages[3] ?? "", /session move failed/);
});
