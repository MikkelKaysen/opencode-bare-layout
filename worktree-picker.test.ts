import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorktrees, pickExistingWorktree } from "./worktree-picker.ts";

const porcelain = [
  "worktree /repo.git",
  "bare",
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

test("inside a session, moves the session to the selected worktree and omits the current path", async () => {
  const moved: Array<{ sessionID: string; directory: string }> = [];
  const created: string[] = [];
  const navigated: string[] = [];
  const messages: string[] = [];
  let offered: readonly { title: string; value: string; description: string }[] =
    [];

  await pickExistingWorktree({
    sessionID: "session-123",
    location: "/repo.git/current",
    list: async (location) => {
      assert.equal(location, "/repo.git/current");
      return porcelain;
    },
    select: async (choices) => {
      offered = choices;
      return choices[0]?.value;
    },
    move: async (sessionID, directory) => moved.push({ sessionID, directory }),
    create: async (directory) => {
      created.push(directory);
      return { id: "new" };
    },
    navigate: (sessionID) => navigated.push(sessionID),
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
  assert.deepEqual(created, []);
  assert.deepEqual(navigated, []);
  assert.deepEqual(messages, []);
});

test("outside a session, creates a session in the selected worktree and navigates to it", async () => {
  const moved: string[] = [];
  const created: string[] = [];
  const navigated: string[] = [];
  const messages: string[] = [];
  let offered: readonly { title: string; value: string }[] = [];

  await pickExistingWorktree({
    sessionID: undefined,
    location: "/repo.git/current",
    list: async () => porcelain,
    select: async (choices) => {
      offered = choices;
      return choices[1]?.value;
    },
    move: async (sessionID, directory) => moved.push(`${sessionID}:${directory}`),
    create: async (directory) => {
      created.push(directory);
      return { id: "ses-new" };
    },
    navigate: (sessionID) => navigated.push(sessionID),
    toast: (message) => messages.push(message),
  });

  assert.deepEqual(
    offered.map((choice) => choice.value),
    ["/repo.git/current", "/repo.git/feature-dir"],
  );
  assert.deepEqual(created, ["/repo.git/feature-dir"]);
  assert.deepEqual(navigated, ["ses-new"]);
  assert.deepEqual(moved, []);
  assert.deepEqual(messages, []);
});

test("cancellation creates nothing and moves nothing in either mode", async () => {
  const effects: string[] = [];
  const common = {
    location: "/repo.git/current",
    list: async () => porcelain,
    select: async () => undefined,
    move: async (_sessionID: string, directory: string) => {
      effects.push(`move:${directory}`);
    },
    create: async (directory: string) => {
      effects.push(`create:${directory}`);
      return { id: "ses-new" };
    },
    navigate: (sessionID: string) => effects.push(`navigate:${sessionID}`),
    toast: (message: string) => effects.push(`toast:${message}`),
  };

  await pickExistingWorktree({ ...common, sessionID: "session-123" });
  await pickExistingWorktree({ ...common, sessionID: undefined });

  assert.deepEqual(effects, []);
});

test("reports missing location, empty lists, and Git/API errors", async () => {
  const moved: string[] = [];
  const created: string[] = [];
  const messages: string[] = [];
  const common = {
    location: "/repo.git/current",
    list: async () => "worktree /repo.git/current\nbranch refs/heads/current\n",
    select: async (choices: readonly { value: string }[]) => choices[0]?.value,
    move: async (_sessionID: string, directory: string) => {
      moved.push(directory);
    },
    create: async (directory: string) => {
      created.push(directory);
      return { id: "ses-new" };
    },
    navigate: () => {},
    toast: (message: string) => messages.push(message),
  };

  // No location at all: nothing can be chosen, in either mode.
  await pickExistingWorktree({ ...common, location: undefined, sessionID: "s1" });
  await pickExistingWorktree({ ...common, location: undefined, sessionID: undefined });

  // Only the current worktree exists: move mode has nothing to offer.
  await pickExistingWorktree({ ...common, sessionID: "s1" });

  // Git failure in new-session mode.
  await pickExistingWorktree({
    ...common,
    sessionID: undefined,
    list: async () => {
      throw new Error("git unavailable");
    },
  });

  // Session move failure in move mode.
  await pickExistingWorktree({
    ...common,
    sessionID: "s1",
    list: async () => "worktree /repo.git/other\nbranch refs/heads/other\n",
    move: async () => {
      throw new Error("session move failed");
    },
  });

  // Session create failure in new-session mode.
  await pickExistingWorktree({
    ...common,
    sessionID: undefined,
    list: async () => "worktree /repo.git/other\nbranch refs/heads/other\n",
    create: async () => {
      throw new Error("session create failed");
    },
  });

  assert.deepEqual(moved, []);
  assert.deepEqual(created, []);
  assert.equal(messages[0], "Could not determine the active location.");
  assert.equal(messages[1], "Could not determine the active location.");
  assert.equal(messages[2], "No other linked worktrees found.");
  assert.match(messages[3] ?? "", /git unavailable/);
  assert.match(messages[4] ?? "", /session move failed/);
  assert.match(messages[5] ?? "", /session create failed/);
  assert.equal(messages.length, 6);
});

test("new-session mode with no branch-bearing worktrees reports an empty list without suggesting legacy commands", async () => {
  const messages: string[] = [];
  await pickExistingWorktree({
    sessionID: undefined,
    location: "/repo.git",
    list: async () => "worktree /repo.git\nbare\n",
    select: async () => {
      throw new Error("select must not run");
    },
    move: async () => {},
    create: async () => {
      throw new Error("create must not run");
    },
    navigate: () => {},
    toast: (message) => messages.push(message),
  });

  assert.deepEqual(messages, ["No linked worktrees with branches found."]);
});
