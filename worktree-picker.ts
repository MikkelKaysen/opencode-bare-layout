import { resolve as resolvePath } from "node:path";

export interface WorktreeEntry {
  path: string;
  branch?: string;
}

export interface WorktreeChoice {
  title: string;
  value: string;
  description: string;
}

/** Parse `git worktree list --porcelain` into recorded paths and branch names. */
export function parseWorktrees(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of out.replace(/\r\n/g, "\n").split("\n\n")) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        const value = line.slice("worktree ".length);
        if (value) path = value;
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        if (ref.startsWith("refs/heads/") && ref.length > "refs/heads/".length) {
          branch = ref.slice("refs/heads/".length);
        }
      }
    }
    if (path) entries.push(branch ? { path, branch } : { path });
  }
  return entries;
}

/**
 * Collects the other linked worktrees, lets the user choose one, and moves
 * the specified session. The UI and Git operations are injected so the
 * selection flow can be tested without a running TUI.
 */
export async function pickExistingWorktree(input: {
  sessionID?: string;
  location?: string;
  list: (location: string) => Promise<string>;
  select: (choices: readonly WorktreeChoice[]) => Promise<string | undefined>;
  move: (sessionID: string, directory: string) => Promise<void>;
  toast: (message: string) => void;
}): Promise<void> {
  if (!input.sessionID) {
    input.toast("Open a session before choosing an existing worktree.");
    return;
  }
  if (!input.location) {
    input.toast("Could not determine the active session location.");
    return;
  }
  const location = input.location;

  try {
    const current = resolvePath(location);
    const choices = parseWorktrees(await input.list(location))
      .filter(
        (entry): entry is WorktreeEntry & { branch: string } =>
          Boolean(entry.branch) &&
          resolvePath(location, entry.path) !== current,
      )
      .map((entry) => ({
        title: entry.branch,
        value: entry.path,
        description: entry.path,
      }));

    if (choices.length === 0) {
      input.toast(
        "No other linked worktrees found. Use /worktree-existing <branch> to attach to a branch.",
      );
      return;
    }

    const directory = await input.select(choices);
    if (directory === undefined) return;
    await input.move(input.sessionID, directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.toast(`Could not switch worktrees: ${message}`);
  }
}
